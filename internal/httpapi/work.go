package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// Provisional content format: titles, descriptions and comments are stored as
// text until the E2EE key directory exists (docs/adr/0012-work-v1-plaintext.md).

// contentBodyLimit bounds JSON bodies that may carry encrypted fields (up to ~350 KB each).
const contentBodyLimit = 1 << 20

var defaultColumns = []struct{ name, category string }{
	{"A fazer", "todo"}, {"Em andamento", "in_progress"}, {"Em revisão", "in_progress"}, {"Concluído", "done"},
}

// reader authenticates a read request.
func (h *apiServer) reader(w http.ResponseWriter, r *http.Request) (sqlc.FindActiveSessionByTokenHashRow, bool) {
	session, status := h.activeSession(r)
	if status != http.StatusOK {
		w.WriteHeader(status)
		return session, false
	}
	return session, true
}

// mutator authenticates a state-changing request: origin, session and CSRF.
func (h *apiServer) mutator(w http.ResponseWriter, r *http.Request) (sqlc.FindActiveSessionByTokenHashRow, bool) {
	if !sameOrigin(r) {
		w.WriteHeader(http.StatusForbidden)
		return sqlc.FindActiveSessionByTokenHashRow{}, false
	}
	session, ok := h.reader(w, r)
	if !ok {
		return session, false
	}
	if !identity.VerifyCSRFToken(r.Header.Get("X-CSRF-Token"), session.CsrfHash) {
		w.WriteHeader(http.StatusForbidden)
		return session, false
	}
	return session, true
}

type projectAccess struct {
	access   work.Access
	archived bool
}

// lookupAccess reports the account's access to a project without writing a
// response; found is false for unknown projects and non-members alike.
func lookupAccess(ctx context.Context, q *sqlc.Queries, projectID, accountID pgtype.UUID) (access projectAccess, found bool, err error) {
	row, err := q.GetProjectAccess(ctx, sqlc.GetProjectAccessParams{ID: projectID, AccountID: accountID})
	if errors.Is(err, pgx.ErrNoRows) {
		return projectAccess{}, false, nil
	}
	if err != nil {
		return projectAccess{}, false, err
	}
	return projectAccess{
		access:   work.Access{Kind: row.MembershipKind, Manager: row.IsManager, External: row.ExternalPermissions},
		archived: row.Archived,
	}, true, nil
}

// loadAccess returns false after writing 404 when the account is not a member:
// unknown and inaccessible projects are indistinguishable.
func loadAccess(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, projectID, accountID pgtype.UUID) (projectAccess, bool) {
	access, found, err := lookupAccess(ctx, q, projectID, accountID)
	if err != nil {
		serverError(w, nil, err)
		return projectAccess{}, false
	}
	if !found {
		w.WriteHeader(http.StatusNotFound)
		return projectAccess{}, false
	}
	return access, true
}

// projectFields is the common shape of a project row, whichever query produced it.
type projectFields struct {
	ID                                     pgtype.UUID
	Name, Description, Color, Icon         string
	Version, ContentRevision               int32
	Manager, Encrypted, Archived           bool
	InvitePolicy                           string
	NameEnc, DescriptionEnc                []byte
	ContentAuthorID, ContentSignerDeviceID pgtype.UUID
	Permissions                            []string
}

func toProject(f projectFields) gen.Project {
	project := gen.Project{
		Id: fromPG(f.ID), Name: f.Name, Description: f.Description, Color: f.Color, Icon: f.Icon, Version: int(f.Version),
		IsManager: f.Manager, Encrypted: f.Encrypted, Archived: &f.Archived, InvitePolicy: invitePolicyOf(f.InvitePolicy), ContentRevision: int(f.ContentRevision),
		Permissions: f.Permissions,
	}
	if f.Encrypted {
		project.NameEnc, project.DescriptionEnc = blob(f.NameEnc), blob(f.DescriptionEnc)
		if f.ContentAuthorID.Valid {
			author := fromPG(f.ContentAuthorID)
			project.ContentAuthorId = &author
		}
		if f.ContentSignerDeviceID.Valid {
			signer := fromPG(f.ContentSignerDeviceID)
			project.SignerDeviceId = &signer
		}
	}
	return project
}

func fieldsOf(p sqlc.Project, access work.Access) projectFields {
	manager := access.Manager
	return projectFields{
		Permissions: access.Permissions(),
		ID:          p.ID, Name: p.Name, Description: p.Description, Color: p.Color, Icon: p.Icon, Version: p.Version, Manager: manager,
		Archived: p.Archived, InvitePolicy: p.InvitePolicy, Encrypted: p.Encrypted, NameEnc: p.NameEnc, DescriptionEnc: p.DescriptionEnc, ContentRevision: p.ContentRevision,
		ContentAuthorID: p.ContentAuthorID, ContentSignerDeviceID: p.ContentSignerDeviceID,
	}
}

func (h *apiServer) ListProjects(w http.ResponseWriter, r *http.Request, params gen.ListProjectsParams) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := sqlc.New(h.auth.pool).ListProjectsForAccount(ctx, sqlc.ListProjectsForAccountParams{AccountID: session.AccountID, IncludeArchived: params.IncludeArchived != nil && *params.IncludeArchived})
	if err != nil {
		serverError(w, r, err)
		return
	}
	projects := make([]gen.Project, 0, len(rows))
	for _, row := range rows {
		projects = append(projects, toProject(projectFields{
			ID: row.ID, Name: row.Name, Description: row.Description, Color: row.Color, Icon: row.Icon, Version: row.Version, Manager: row.IsManager,
			Archived: row.Archived, InvitePolicy: row.InvitePolicy, Encrypted: row.Encrypted, NameEnc: row.NameEnc, DescriptionEnc: row.DescriptionEnc, ContentRevision: row.ContentRevision,
			ContentAuthorID: row.ContentAuthorID, ContentSignerDeviceID: row.ContentSignerDeviceID,
			Permissions: work.Access{Kind: row.MembershipKind, Manager: row.IsManager, External: row.ExternalPermissions}.Permissions(),
		}))
	}
	writeJSON(w, http.StatusOK, projects)
}

func (h *apiServer) CreateProject(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var payload gen.CreateProjectRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	description, color := "", "#63745A"
	if payload.Description != nil {
		description = *payload.Description
	}
	if payload.Color != nil {
		color = *payload.Color
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	var project sqlc.Project
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		membership, err := q.GetOrganizationMembershipForAccount(ctx, session.AccountID)
		if err != nil {
			return err
		}
		project, err = q.CreateProject(ctx, sqlc.CreateProjectParams{
			OrganizationID: membership.OrganizationID, Name: payload.Name, Description: description,
			Color: color, Icon: "folder", CreatedBy: session.AccountID,
		})
		if isConstraintViolation(err) {
			return statusError(http.StatusBadRequest)
		}
		if err != nil {
			return err
		}
		return seedNewProject(ctx, q, project.ID, session.AccountID)
	})
	if respondError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusCreated, toProject(fieldsOf(project, work.Access{Kind: "internal", Manager: true})))
}

// seedNewProject gives a new project its creator as manager, the default
// external policy, the "geral" channel and the default board columns.
func seedNewProject(ctx context.Context, q *sqlc.Queries, projectID, creator pgtype.UUID) error {
	if err := q.AddProjectMember(ctx, sqlc.AddProjectMemberParams{ProjectID: projectID, AccountID: creator, IsManager: true}); err != nil {
		return err
	}
	if err := q.CreateExternalProjectPolicy(ctx, projectID); err != nil {
		return err
	}
	if _, err := q.CreateConversation(ctx, sqlc.CreateConversationParams{ProjectID: projectID, Name: "geral"}); err != nil {
		return err
	}
	for index, column := range defaultColumns {
		if _, err := q.CreateBoardColumn(ctx, sqlc.CreateBoardColumnParams{
			ProjectID: projectID, Name: column.name, Position: int32(index), Category: column.category,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (h *apiServer) GetProject(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	access, ok := loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID)
	if !ok {
		return
	}
	project, err := q.GetProject(ctx, pgUUID(projectId))
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toProject(fieldsOf(project, access.access)))
}

func (h *apiServer) ListProjectMembers(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	if _, ok = loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID); !ok {
		return
	}
	rows, err := q.ListProjectMembers(ctx, pgUUID(projectId))
	if err != nil {
		serverError(w, r, err)
		return
	}
	members := make([]gen.ProjectMember, 0, len(rows))
	for _, row := range rows {
		members = append(members, gen.ProjectMember{
			AccountId: fromPG(row.AccountID), Email: openapi_types.Email(row.EmailNormalized),
			MembershipKind: gen.ProjectMemberMembershipKind(row.MembershipKind), IsManager: row.IsManager,
		})
	}
	writeJSON(w, http.StatusOK, members)
}

func (h *apiServer) AddProjectMember(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.AddProjectMemberRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	email, err := identity.NormalizeEmail(string(payload.Email))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	access, ok := loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID)
	if !ok {
		return
	}
	policy := "admins"
	if project, projectErr := q.GetProject(ctx, pgUUID(projectId)); projectErr == nil {
		policy = project.InvitePolicy
	}
	if !access.access.Manager && !mayBringPeopleIn(policy, access.access, false) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if access.archived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	target, err := q.FindOrganizationMemberByEmail(ctx, sqlc.FindOrganizationMemberByEmailParams{ID: pgUUID(projectId), EmailNormalized: email})
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	// Only a manager brings in an external person; the policy lets others add internal colleagues.
	if !access.access.Manager && target.MembershipKind != "internal" {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	// A project manager never promotes an external member to manager.
	manager := access.access.Manager && payload.IsManager != nil && *payload.IsManager && target.MembershipKind == "internal"
	err = h.inTx(ctx, func(q *sqlc.Queries) error {
		if err := q.AddProjectMember(ctx, sqlc.AddProjectMemberParams{ProjectID: pgUUID(projectId), AccountID: target.AccountID, IsManager: manager}); err != nil {
			return err
		}
		return refreshProjectDomains(ctx, q, pgUUID(projectId))
	})
	if respondError(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func toPolicy(permissions []string, version int32) gen.ExternalPolicy {
	converted := make([]gen.ExternalPermission, 0, len(permissions))
	for _, permission := range permissions {
		converted = append(converted, gen.ExternalPermission(permission))
	}
	return gen.ExternalPolicy{Permissions: converted, Version: int(version)}
}

func (h *apiServer) GetExternalPolicy(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	if _, ok = loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID); !ok {
		return
	}
	policy, err := q.GetExternalProjectPolicy(ctx, pgUUID(projectId))
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toPolicy(policy.Permissions, policy.Version))
}

func (h *apiServer) UpdateExternalPolicy(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.UpdateExternalPolicyRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	requested := make([]string, 0, len(payload.Permissions))
	for _, permission := range payload.Permissions {
		requested = append(requested, string(permission))
	}
	permissions, err := work.ValidatePolicy(requested)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var policy sqlc.UpdateExternalProjectPolicyRow
	err = h.inTx(ctx, func(q *sqlc.Queries) error {
		access, ok := loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID)
		if !ok {
			return errResponded
		}
		if !access.access.Manager {
			return statusError(http.StatusForbidden)
		}
		var err error
		policy, err = q.UpdateExternalProjectPolicy(ctx, sqlc.UpdateExternalProjectPolicyParams{
			ProjectID: pgUUID(projectId), Permissions: permissions, Version: int32(payload.Version),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return statusError(http.StatusConflict)
		}
		if err != nil {
			return err
		}
		members, err := projectRecipients(ctx, q, pgUUID(projectId), "")
		if err != nil {
			return err
		}
		if err = emitEvent(ctx, q, members, eventSpec{Type: "policy.changed", ResourceID: pgUUID(projectId), Version: policy.Version, ProjectID: pgUUID(projectId)}); err != nil {
			return err
		}
		return refreshProjectDomains(ctx, q, pgUUID(projectId))
	})
	if respondError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, toPolicy(policy.Permissions, policy.Version))
}

func (h *apiServer) ListBoardColumns(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	access, ok := loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID)
	if !ok {
		return
	}
	if !access.access.Can(work.WorkRead) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	rows, err := q.ListBoardColumns(ctx, pgUUID(projectId))
	if err != nil {
		serverError(w, r, err)
		return
	}
	columns := make([]gen.BoardColumn, 0, len(rows))
	for _, row := range rows {
		columns = append(columns, gen.BoardColumn{Id: fromPG(row.ID), Name: row.Name, Position: int(row.Position), Category: gen.BoardColumnCategory(row.Category)})
	}
	writeJSON(w, http.StatusOK, columns)
}

// UpdateProject replaces a project's plaintext name and description with their
// encrypted form (managers only). There is no plaintext rename: once the
// project has a key, it never has one again.
func (h *apiServer) UpdateProject(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.UpdateProjectRequest
	if !decodeJSONBodyLimit(w, r, &payload, contentBodyLimit) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		project, err := q.GetProjectForUpdate(ctx, pgUUID(projectId))
		if errors.Is(err, pgx.ErrNoRows) {
			return statusError(http.StatusNotFound)
		}
		if err != nil {
			return err
		}
		access, ok := loadAccess(ctx, w, q, project.ID, session.AccountID)
		if !ok {
			return errResponded
		}
		if !access.access.Manager {
			return statusError(http.StatusForbidden)
		}
		revision := int32(payload.ContentRevision)
		writer, fail, err := prepareEncrypted(ctx, q, session.AccountID, project.ID, "work", optionalUUIDValue(toPG(payload.SignerDeviceId)))
		if err != nil {
			return err
		}
		if fail == nil && revision != project.ContentRevision+1 {
			fail = &encFailure{http.StatusConflict, gen.ApiErrorCodeBadRevision}
		}
		if fail == nil {
			if fail = writer.verify(session.AccountID, projectResource(project.ID, "name"), revision, payload.NameEnc); fail == nil {
				fail = writer.verify(session.AccountID, projectResource(project.ID, "desc"), revision, payload.DescriptionEnc)
			}
		}
		if fail != nil {
			fail.write(w)
			return errResponded
		}
		nameEnc, _ := unb64(payload.NameEnc, 0)
		descriptionEnc, _ := unb64(payload.DescriptionEnc, 0)
		changed, err := q.SetProjectContent(ctx, sqlc.SetProjectContentParams{
			ID: project.ID, NameEnc: nameEnc, DescriptionEnc: descriptionEnc, ContentRevision: revision,
			ContentAuthorID: session.AccountID, ContentSignerDeviceID: writer.signer.ID,
		})
		if err != nil {
			return err
		}
		if changed == 0 {
			return statusError(http.StatusConflict)
		}
		return announceProjectChanged(ctx, q, project.ID)
	})
	if respondError(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// announceProjectChanged tells every project member to re-read names.
func announceProjectChanged(ctx context.Context, q *sqlc.Queries, projectID pgtype.UUID) error {
	members, err := projectRecipients(ctx, q, projectID, "")
	if err != nil {
		return err
	}
	return emitEvent(ctx, q, members, eventSpec{Type: "project.changed", ResourceID: projectID, ProjectID: projectID})
}

func invitePolicyOf(policy string) *gen.InvitePolicy {
	value := gen.InvitePolicy(policy)
	if !value.Valid() {
		value = gen.Admins
	}
	return &value
}

// mayBringPeopleIn says whether someone may invite or add people to a project
// under its invite policy. Organization administrators always may; externals never.
func mayBringPeopleIn(policy string, access work.Access, orgAdmin bool) bool {
	switch {
	case orgAdmin:
		return true
	case access.Kind != "internal":
		return false
	case access.Manager:
		return policy == "managers" || policy == "members"
	default:
		return policy == "members"
	}
}
