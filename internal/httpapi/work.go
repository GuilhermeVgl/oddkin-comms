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
	"github.com/google/uuid"
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

func toWorkItem(item sqlc.WorkItem) gen.WorkItem {
	response := gen.WorkItem{
		Id: fromPG(item.ID), ProjectId: fromPG(item.ProjectID), Kind: gen.WorkItemKind(item.Kind),
		Title: item.Title, Description: item.Description, Priority: gen.WorkItemPriority(item.Priority),
		ColumnId: fromPG(item.ColumnID), Version: int(item.Version),
		CreatedAt: item.CreatedAt.Time, UpdatedAt: item.UpdatedAt.Time,
		Encrypted: item.Encrypted, ContentRevision: int(item.ContentRevision),
	}
	if item.Encrypted {
		titleEnc, descriptionEnc := *blob(item.TitleEnc), *blob(item.DescriptionEnc)
		response.TitleEnc, response.DescriptionEnc = &titleEnc, &descriptionEnc
		if item.ContentAuthorID.Valid {
			author := fromPG(item.ContentAuthorID)
			response.ContentAuthorId = &author
		}
		if item.ContentSignerDeviceID.Valid {
			signer := fromPG(item.ContentSignerDeviceID)
			response.SignerDeviceId = &signer
		}
	}
	if item.ParentID.Valid {
		parent := fromPG(item.ParentID)
		response.ParentId = &parent
	}
	if item.SprintID.Valid {
		sprint := fromPG(item.SprintID)
		response.SprintId = &sprint
	}
	if item.EpicID.Valid {
		epic := fromPG(item.EpicID)
		response.EpicId = &epic
	}
	if item.AssigneeID.Valid {
		assignee := fromPG(item.AssigneeID)
		response.AssigneeId = &assignee
	}
	if item.DueDate.Valid {
		response.DueDate = &openapi_types.Date{Time: item.DueDate.Time}
	}
	return response
}

func (h *apiServer) ListWorkItems(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
	rows, err := q.ListWorkItems(ctx, pgUUID(projectId))
	if err != nil {
		serverError(w, r, err)
		return
	}
	items := make([]gen.WorkItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, toWorkItem(row))
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *apiServer) CreateWorkItem(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.CreateWorkItemRequest
	if !decodeJSONBodyLimit(w, r, &payload, contentBodyLimit) {
		return
	}
	encrypted := payload.TitleEnc != nil || payload.DescriptionEnc != nil
	if encrypted && (payload.TitleEnc == nil || payload.DescriptionEnc == nil || payload.Id == nil || payload.Title != nil || payload.Description != nil) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if !encrypted && payload.Title == nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if (payload.Kind == "task") == (payload.ParentId != nil) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	var item sqlc.WorkItem
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		access, ok := loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID)
		if !ok {
			return errResponded
		}
		if !access.access.Can(work.WorkRead) || !access.access.Can(work.WorkCreate) {
			return statusError(http.StatusForbidden)
		}
		if access.archived {
			return statusError(http.StatusConflict)
		}
		writer, err := checkWorkItemCreateContent(ctx, w, q, session.AccountID, pgUUID(projectId), payload)
		if err != nil {
			return err
		}
		params, err := newWorkItemParams(ctx, q, session.AccountID, pgUUID(projectId), payload)
		if err != nil {
			return err
		}
		item, err = insertWorkItem(ctx, q, session.AccountID, params, writer, payload)
		switch {
		case isUniqueViolation(err):
			return statusError(http.StatusConflict)
		case isConstraintViolation(err):
			return statusError(http.StatusBadRequest)
		case err != nil:
			return err
		}
		if err = emitWorkItemChanged(ctx, q, item); err != nil {
			return err
		}
		return notifyAssignment(ctx, q, item, session.AccountID, pgtype.UUID{})
	})
	if respondError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusCreated, toWorkItem(item))
}

// checkWorkItemCreateContent validates the content of a new activity: an
// encrypted one needs a usable domain and signed envelopes, a plain one is
// refused once the project encrypts its work. It returns the validated writer
// for an encrypted write and nil otherwise. A refusal is written to w and
// reported as errResponded.
func checkWorkItemCreateContent(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, account, projectID pgtype.UUID, payload gen.CreateWorkItemRequest) (*encContext, error) {
	if payload.TitleEnc == nil && payload.DescriptionEnc == nil {
		fail, err := requirePlaintextAllowed(ctx, q, projectID, "work")
		if err != nil {
			return nil, err
		}
		if fail != nil {
			fail.write(w)
			return nil, errResponded
		}
		return nil, nil
	}
	var signerID *pgtype.UUID
	if payload.SignerDeviceId != nil {
		signerID = optionalUUIDValue(toPG(*payload.SignerDeviceId))
	}
	writer, fail, err := prepareEncrypted(ctx, q, account, projectID, "work", signerID)
	if err != nil {
		return nil, err
	}
	if fail == nil {
		id := toPG(*payload.Id)
		if fail = writer.verify(account, workItemResource(id, "title"), 1, string(*payload.TitleEnc)); fail == nil {
			fail = writer.verify(account, workItemResource(id, "desc"), 1, string(*payload.DescriptionEnc))
		}
	}
	if fail != nil {
		fail.write(w)
		return nil, errResponded
	}
	return writer, nil
}

// newWorkItemParams builds the plain insert for a new activity. Without a
// requested column it lands in the board's first "todo" column.
func newWorkItemParams(ctx context.Context, q *sqlc.Queries, account, projectID pgtype.UUID, payload gen.CreateWorkItemRequest) (sqlc.CreateWorkItemParams, error) {
	title := ""
	if payload.Title != nil {
		title = *payload.Title
	}
	params := sqlc.CreateWorkItemParams{
		ProjectID: projectID, Kind: string(payload.Kind), ParentID: optionalUUID(payload.ParentId), Title: title,
		AssigneeID: optionalUUID(payload.AssigneeId), Priority: "normal", CreatedBy: account,
	}
	if payload.Description != nil {
		params.Description = *payload.Description
	}
	if payload.Priority != nil {
		params.Priority = string(*payload.Priority)
	}
	if payload.DueDate != nil {
		params.DueDate = pgtype.Date{Time: payload.DueDate.Time, Valid: true}
	}
	if payload.ColumnId != nil {
		params.ColumnID = pgUUID(uuid.UUID(*payload.ColumnId))
		return params, nil
	}
	columns, err := q.ListBoardColumns(ctx, projectID)
	if err != nil {
		return params, err
	}
	if len(columns) == 0 {
		return params, errors.New("project has no board columns")
	}
	params.ColumnID = columns[0].ID
	for _, column := range columns {
		if column.Category == "todo" {
			params.ColumnID = column.ID
			break
		}
	}
	return params, nil
}

// insertWorkItem stores the activity, encrypted when a validated writer is given.
func insertWorkItem(ctx context.Context, q *sqlc.Queries, account pgtype.UUID, params sqlc.CreateWorkItemParams, writer *encContext, payload gen.CreateWorkItemRequest) (sqlc.WorkItem, error) {
	if writer == nil {
		return q.CreateWorkItem(ctx, params)
	}
	titleEnc, _ := unb64(string(*payload.TitleEnc), 0)
	descriptionEnc, _ := unb64(string(*payload.DescriptionEnc), 0)
	return q.CreateEncryptedWorkItem(ctx, sqlc.CreateEncryptedWorkItemParams{
		ID: toPG(*payload.Id), ProjectID: params.ProjectID, Kind: params.Kind, ParentID: params.ParentID,
		AssigneeID: params.AssigneeID, DueDate: params.DueDate, Priority: params.Priority, ColumnID: params.ColumnID,
		CreatedBy: account, TitleEnc: titleEnc, DescriptionEnc: descriptionEnc, ContentSignerDeviceID: writer.signer.ID,
	})
}

func (h *apiServer) UpdateWorkItem(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.UpdateWorkItemRequest
	if !decodeJSONBodyLimit(w, r, &payload, contentBodyLimit) {
		return
	}
	encContent := payload.TitleEnc != nil || payload.DescriptionEnc != nil
	if encContent && (payload.TitleEnc == nil || payload.DescriptionEnc == nil || payload.SignerDeviceId == nil || payload.ContentRevision == nil ||
		payload.Title != nil || payload.Description != nil) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	var updated sqlc.WorkItem
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		// Lock the row first; authorization is checked on the locked row's project.
		item, err := q.GetWorkItemForUpdate(ctx, pgUUID(workItemId))
		if errors.Is(err, pgx.ErrNoRows) {
			return statusError(http.StatusNotFound)
		}
		if err != nil {
			return err
		}
		access, ok := loadAccess(ctx, w, q, item.ProjectID, session.AccountID)
		if !ok {
			return errResponded
		}
		if err = authorizeWorkItemUpdate(access, item, payload); err != nil {
			return err
		}
		writer, err := checkWorkItemContentWrite(ctx, w, q, session.AccountID, item, payload)
		if err != nil {
			return err
		}
		params, err := h.workItemUpdateParams(ctx, q, item, payload)
		if err != nil {
			return err
		}
		updated, err = q.UpdateWorkItem(ctx, params)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return statusError(http.StatusConflict)
		case isConstraintViolation(err):
			return statusError(http.StatusBadRequest)
		case err != nil:
			return err
		}
		if encContent {
			if updated, err = storeWorkItemContent(ctx, q, session.AccountID, item.ID, writer, payload); err != nil {
				return err
			}
		}
		return announceWorkItemUpdate(ctx, q, session.AccountID, item, updated, payload.ColumnId != nil)
	})
	if respondError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, toWorkItem(updated))
}

// authorizeWorkItemUpdate checks that the caller may make every kind of change
// the request asks for, and that the activity is writable at the version the
// caller saw.
func authorizeWorkItemUpdate(access projectAccess, item sqlc.WorkItem, payload gen.UpdateWorkItemRequest) error {
	editing := payload.Title != nil || payload.Description != nil || payload.Priority != nil ||
		payload.AssigneeId != nil || payload.ClearAssignee != nil || payload.DueDate != nil || payload.ClearDueDate != nil ||
		payload.EpicId != nil || payload.ClearEpic != nil || payload.TitleEnc != nil || payload.DescriptionEnc != nil
	moving := payload.ColumnId != nil
	archiving := payload.Archived != nil
	planning := payload.SprintId != nil || payload.ClearSprint != nil
	if !access.access.Can(work.WorkRead) ||
		(editing && !access.access.Can(work.WorkEdit)) ||
		(moving && !access.access.Can(work.WorkMove)) ||
		(archiving && !access.access.Can(work.WorkArchive)) ||
		(planning && !access.access.Can(work.PlanningEdit)) {
		return statusError(http.StatusForbidden)
	}
	if access.archived || int32(payload.Version) != item.Version {
		return statusError(http.StatusConflict)
	}
	return nil
}

// checkWorkItemContentWrite validates the content part of an update: an
// encrypted write must be signed, carry the next revision and use a usable
// domain; a plain-text edit is refused once the project encrypts its work. It
// returns the validated writer for an encrypted write and nil otherwise. A
// refusal is written to w and reported as errResponded.
func checkWorkItemContentWrite(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, account pgtype.UUID, item sqlc.WorkItem, payload gen.UpdateWorkItemRequest) (*encContext, error) {
	if payload.TitleEnc != nil || payload.DescriptionEnc != nil {
		revision := int32(*payload.ContentRevision)
		writer, fail, err := prepareEncrypted(ctx, q, account, item.ProjectID, "work", optionalUUIDValue(toPG(*payload.SignerDeviceId)))
		if err != nil {
			return nil, err
		}
		if fail == nil && revision != item.ContentRevision+1 {
			fail = &encFailure{http.StatusConflict, gen.ApiErrorCodeBadRevision}
		}
		if fail == nil {
			if fail = writer.verify(account, workItemResource(item.ID, "title"), revision, *payload.TitleEnc); fail == nil {
				fail = writer.verify(account, workItemResource(item.ID, "desc"), revision, *payload.DescriptionEnc)
			}
		}
		if fail != nil {
			fail.write(w)
			return nil, errResponded
		}
		return writer, nil
	}
	if payload.Title != nil || payload.Description != nil {
		fail, err := requirePlaintextAllowed(ctx, q, item.ProjectID, "work")
		if err != nil {
			return nil, err
		}
		if fail != nil {
			fail.write(w)
			return nil, errResponded
		}
	}
	return nil, nil
}

// workItemUpdateParams turns the request into the optimistic update. Planning
// references are checked here, and a move to another column applies the
// completion rules of SPEC 6.5 inside the caller's transaction.
func (h *apiServer) workItemUpdateParams(ctx context.Context, q *sqlc.Queries, item sqlc.WorkItem, payload gen.UpdateWorkItemRequest) (sqlc.UpdateWorkItemParams, error) {
	params := sqlc.UpdateWorkItemParams{ID: item.ID, Version: item.Version}
	if payload.Title != nil {
		params.Title = pgtype.Text{String: *payload.Title, Valid: true}
	}
	if payload.Description != nil {
		params.Description = pgtype.Text{String: *payload.Description, Valid: true}
	}
	if payload.Priority != nil {
		params.Priority = pgtype.Text{String: string(*payload.Priority), Valid: true}
	}
	if payload.Archived != nil {
		params.Archived = pgtype.Bool{Bool: *payload.Archived, Valid: true}
	}
	if payload.ClearAssignee != nil && *payload.ClearAssignee {
		params.SetAssignee = true
	} else if payload.AssigneeId != nil {
		params.SetAssignee, params.AssigneeID = true, optionalUUID(payload.AssigneeId)
	}
	if err := sprintChange(ctx, q, item, payload, &params); err != nil {
		return params, err
	}
	if payload.ClearEpic != nil && *payload.ClearEpic {
		params.SetEpic = true
	} else if payload.EpicId != nil {
		params.SetEpic, params.EpicID = true, optionalUUID(payload.EpicId)
	}
	if payload.ClearDueDate != nil && *payload.ClearDueDate {
		params.SetDueDate = true
	} else if payload.DueDate != nil {
		params.SetDueDate, params.DueDate = true, pgtype.Date{Time: payload.DueDate.Time, Valid: true}
	}
	if payload.ColumnId != nil {
		target, err := q.GetBoardColumn(ctx, sqlc.GetBoardColumnParams{ID: pgUUID(uuid.UUID(*payload.ColumnId)), ProjectID: item.ProjectID})
		if errors.Is(err, pgx.ErrNoRows) {
			return params, statusError(http.StatusBadRequest)
		}
		if err != nil {
			return params, err
		}
		params.ColumnID = target.ID
		if err = h.applyMoveRules(ctx, q, item, target, payload.CompleteSubtasks != nil && *payload.CompleteSubtasks); err != nil {
			return params, err
		}
	}
	return params, nil
}

// sprintChange sets the sprint of the update. A sprint must belong to the
// project's organization and must not be closed.
func sprintChange(ctx context.Context, q *sqlc.Queries, item sqlc.WorkItem, payload gen.UpdateWorkItemRequest, params *sqlc.UpdateWorkItemParams) error {
	if payload.ClearSprint != nil && *payload.ClearSprint {
		params.SetSprint = true
		return nil
	}
	if payload.SprintId == nil {
		return nil
	}
	organizationID, orgErr := q.GetProjectOrganization(ctx, item.ProjectID)
	sprint, sprintErr := q.GetSprint(ctx, toPG(*payload.SprintId))
	if orgErr != nil || sprintErr != nil || sprint.OrganizationID != organizationID || sprint.State == "closed" {
		return statusError(http.StatusBadRequest)
	}
	params.SetSprint, params.SprintID = true, sprint.ID
	return nil
}

// storeWorkItemContent saves the new envelopes and returns the activity as stored.
func storeWorkItemContent(ctx context.Context, q *sqlc.Queries, account, itemID pgtype.UUID, writer *encContext, payload gen.UpdateWorkItemRequest) (sqlc.WorkItem, error) {
	titleEnc, _ := unb64(*payload.TitleEnc, 0)
	descriptionEnc, _ := unb64(*payload.DescriptionEnc, 0)
	changed, err := q.SetWorkItemContent(ctx, sqlc.SetWorkItemContentParams{
		ID: itemID, TitleEnc: titleEnc, DescriptionEnc: descriptionEnc, ContentRevision: int32(*payload.ContentRevision),
		ContentAuthorID: account, ContentSignerDeviceID: writer.signer.ID,
	})
	if err != nil {
		return sqlc.WorkItem{}, err
	}
	if changed == 0 {
		return sqlc.WorkItem{}, statusError(http.StatusConflict)
	}
	return q.GetWorkItem(ctx, itemID)
}

// announceWorkItemUpdate emits the change event and notifies the people it
// concerns: the new assignee, who also follows the activity from then on, and
// the followers when the activity moved.
func announceWorkItemUpdate(ctx context.Context, q *sqlc.Queries, actor pgtype.UUID, before, after sqlc.WorkItem, moved bool) error {
	if err := emitWorkItemChanged(ctx, q, after); err != nil {
		return err
	}
	if err := notifyAssignment(ctx, q, after, actor, before.AssigneeID); err != nil {
		return err
	}
	if after.AssigneeID.Valid && after.AssigneeID != before.AssigneeID {
		// Whoever takes an activity follows it from then on.
		if err := q.FollowWorkItem(ctx, sqlc.FollowWorkItemParams{WorkItemID: after.ID, AccountID: after.AssigneeID}); err != nil {
			return err
		}
	}
	if moved {
		return notifyFollowers(ctx, q, after, actor)
	}
	return nil
}

// applyMoveRules enforces the completion rules of SPEC 6.5 inside the caller's
// transaction. It returns statusError when the move must be rejected.
func (h *apiServer) applyMoveRules(ctx context.Context, q *sqlc.Queries, item sqlc.WorkItem, target sqlc.BoardColumn, completeSubtasks bool) error {
	current, err := q.GetBoardColumn(ctx, sqlc.GetBoardColumnParams{ID: item.ColumnID, ProjectID: item.ProjectID})
	if err != nil {
		return err
	}
	switch {
	case item.Kind == "task" && target.Category == "done" && current.Category != "done":
		open, err := q.ListOpenSubtasks(ctx, item.ID)
		if err != nil {
			return err
		}
		if len(open) > 0 && !completeSubtasks {
			return statusError(http.StatusConflict)
		}
		for _, subtaskID := range open {
			if err = q.MoveWorkItemToColumn(ctx, sqlc.MoveWorkItemToColumnParams{ID: subtaskID, ColumnID: target.ID}); err != nil {
				return err
			}
		}
	case item.Kind == "task" && current.Category == "done" && target.Category != "done":
		if item.EpicID.Valid {
			return q.ReopenEpic(ctx, item.EpicID)
		}
	case item.Kind == "subtask" && current.Category == "done" && target.Category != "done":
		return h.reopenParentOfSubtask(ctx, q, item)
	}
	return nil
}

// reopenParentOfSubtask moves a finished parent task back to the board's
// reopen column, and reopens its epic, when one of its subtasks is reopened.
func (h *apiServer) reopenParentOfSubtask(ctx context.Context, q *sqlc.Queries, item sqlc.WorkItem) error {
	parent, err := q.GetWorkItemForUpdate(ctx, item.ParentID)
	if err != nil {
		return err
	}
	parentColumn, err := q.GetBoardColumn(ctx, sqlc.GetBoardColumnParams{ID: parent.ColumnID, ProjectID: parent.ProjectID})
	if err != nil {
		return err
	}
	if parentColumn.Category != "done" {
		return nil
	}
	if parent.EpicID.Valid {
		if err = q.ReopenEpic(ctx, parent.EpicID); err != nil {
			return err
		}
	}
	reopen, err := q.FirstColumnForReopen(ctx, item.ProjectID)
	if err != nil {
		return err
	}
	return q.MoveWorkItemToColumn(ctx, sqlc.MoveWorkItemToColumnParams{ID: parent.ID, ColumnID: reopen})
}

// workItemAccess resolves an item and the caller's access without leaking the
// existence of items in projects the caller cannot see.
func (h *apiServer) workItemAccess(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, itemID gen.WorkItemId, accountID pgtype.UUID) (sqlc.WorkItem, projectAccess, bool) {
	item, err := q.GetWorkItem(ctx, pgUUID(itemID))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return item, projectAccess{}, false
	}
	if err != nil {
		serverError(w, nil, err)
		return item, projectAccess{}, false
	}
	access, ok := loadAccess(ctx, w, q, item.ProjectID, accountID)
	return item, access, ok
}

func (h *apiServer) ListWorkItemComments(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	item, access, ok := h.workItemAccess(ctx, w, q, workItemId, session.AccountID)
	if !ok {
		return
	}
	if !access.access.Can(work.WorkRead) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	rows, err := q.ListWorkItemComments(ctx, item.ID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	comments := make([]gen.WorkItemComment, 0, len(rows))
	for _, row := range rows {
		comment := gen.WorkItemComment{Id: fromPG(row.ID), AuthorEmail: row.AuthorEmail.String, Body: row.Body, CreatedAt: row.CreatedAt.Time, Encrypted: row.Encrypted}
		if row.Encrypted {
			comment.BodyEnc = blob(row.BodyEnc)
			if row.AuthorID.Valid {
				author := fromPG(row.AuthorID)
				comment.AuthorId = &author
			}
			if row.ContentSignerDeviceID.Valid {
				signer := fromPG(row.ContentSignerDeviceID)
				comment.SignerDeviceId = &signer
			}
		}
		comments = append(comments, comment)
	}
	writeJSON(w, http.StatusOK, comments)
}

func (h *apiServer) CreateWorkItemComment(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.CreateCommentRequest
	if !decodeJSONBodyLimit(w, r, &payload, contentBodyLimit) {
		return
	}
	encrypted := payload.BodyEnc != nil
	if encrypted && (payload.Id == nil || payload.SignerDeviceId == nil || payload.Body != nil) || !encrypted && payload.Body == nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	item, access, ok := h.workItemAccess(ctx, w, q, workItemId, session.AccountID)
	if !ok {
		return
	}
	if !access.access.Can(work.WorkRead) || !access.access.Can(work.WorkComment) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if access.archived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	var (
		comment sqlc.WorkItemComment
		err     error
	)
	if encrypted {
		comment, err = insertEncryptedComment(ctx, w, q, session.AccountID, item, payload)
	} else {
		comment, err = insertPlainComment(ctx, w, q, session.AccountID, item, payload)
	}
	switch {
	case errors.Is(err, errResponded):
		return
	case isUniqueViolation(err):
		w.WriteHeader(http.StatusConflict)
		return
	case isConstraintViolation(err):
		w.WriteHeader(http.StatusBadRequest)
		return
	case err != nil:
		serverError(w, r, err)
		return
	}
	// Commenting follows the activity; announcing it is best effort, the comment is already saved.
	_ = q.FollowWorkItem(ctx, sqlc.FollowWorkItemParams{WorkItemID: item.ID, AccountID: session.AccountID})
	_ = notifyFollowers(ctx, q, item, session.AccountID)
	response := gen.WorkItemComment{Id: fromPG(comment.ID), AuthorEmail: session.EmailNormalized, Body: comment.Body, CreatedAt: comment.CreatedAt.Time, Encrypted: comment.Encrypted}
	if comment.Encrypted {
		response.BodyEnc = blob(comment.BodyEnc)
		author, signer := fromPG(session.AccountID), fromPG(comment.ContentSignerDeviceID)
		response.AuthorId, response.SignerDeviceId = &author, &signer
	}
	writeJSON(w, http.StatusCreated, response)
}

// insertEncryptedComment stores a comment whose body arrives as an envelope
// signed by the author's device. A refusal is written to w and reported as
// errResponded.
func insertEncryptedComment(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, account pgtype.UUID, item sqlc.WorkItem, payload gen.CreateCommentRequest) (sqlc.WorkItemComment, error) {
	commentID := toPG(*payload.Id)
	writer, fail, err := prepareEncrypted(ctx, q, account, item.ProjectID, "work", optionalUUIDValue(toPG(*payload.SignerDeviceId)))
	if err != nil {
		return sqlc.WorkItemComment{}, err
	}
	if fail == nil {
		fail = writer.verify(account, commentResource(commentID), 1, *payload.BodyEnc)
	}
	if fail != nil {
		fail.write(w)
		return sqlc.WorkItemComment{}, errResponded
	}
	bodyEnc, _ := unb64(*payload.BodyEnc, 0)
	return q.CreateEncryptedComment(ctx, sqlc.CreateEncryptedCommentParams{
		ID: commentID, WorkItemID: item.ID, AuthorID: account, BodyEnc: bodyEnc, ContentSignerDeviceID: writer.signer.ID,
	})
}

// insertPlainComment stores a comment in the clear, which only a project that
// has not started encrypting its work may still do.
func insertPlainComment(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, account pgtype.UUID, item sqlc.WorkItem, payload gen.CreateCommentRequest) (sqlc.WorkItemComment, error) {
	fail, err := requirePlaintextAllowed(ctx, q, item.ProjectID, "work")
	if err != nil {
		return sqlc.WorkItemComment{}, err
	}
	if fail != nil {
		fail.write(w)
		return sqlc.WorkItemComment{}, errResponded
	}
	return q.CreateWorkItemComment(ctx, sqlc.CreateWorkItemCommentParams{WorkItemID: item.ID, AuthorID: account, Body: *payload.Body})
}

// EncryptComment migrates the author's own legacy plaintext comment: the
// plaintext is erased in the same statement that stores the envelope.
func (h *apiServer) EncryptComment(w http.ResponseWriter, r *http.Request, commentId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.EncryptCommentRequest
	if !decodeJSONBodyLimit(w, r, &payload, contentBodyLimit) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		comment, err := q.GetWorkItemComment(ctx, toPG(commentId))
		if errors.Is(err, pgx.ErrNoRows) {
			return statusError(http.StatusNotFound)
		}
		if err != nil {
			return err
		}
		item, err := q.GetWorkItem(ctx, comment.WorkItemID)
		if err != nil {
			return err
		}
		access, ok := loadAccess(ctx, w, q, item.ProjectID, session.AccountID)
		if !ok {
			return errResponded
		}
		if comment.AuthorID != session.AccountID || !access.access.Can(work.WorkRead) {
			return statusError(http.StatusForbidden)
		}
		if comment.Encrypted || access.archived {
			return statusError(http.StatusConflict)
		}
		writer, fail, err := prepareEncrypted(ctx, q, session.AccountID, item.ProjectID, "work", optionalUUIDValue(toPG(payload.SignerDeviceId)))
		if err != nil {
			return err
		}
		if fail == nil {
			fail = writer.verify(session.AccountID, commentResource(comment.ID), 1, payload.BodyEnc)
		}
		if fail != nil {
			fail.write(w)
			return errResponded
		}
		bodyEnc, _ := unb64(payload.BodyEnc, 0)
		_, err = q.SetCommentContent(ctx, sqlc.SetCommentContentParams{ID: comment.ID, BodyEnc: bodyEnc, ContentSignerDeviceID: writer.signer.ID})
		return err
	})
	if respondError(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
