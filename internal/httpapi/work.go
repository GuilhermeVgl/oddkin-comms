package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/oddkin-comms/internal/identity"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/oddkin-comms/internal/work"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

func writeJSON(w http.ResponseWriter, status int, value any) {
	encoded, err := json.Marshal(value)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(encoded)
}

// reader authenticates a read request.
func (h *healthHandler) reader(w http.ResponseWriter, r *http.Request) (sqlc.FindActiveSessionByTokenHashRow, bool) {
	session, status := h.activeSession(r)
	if status != http.StatusOK {
		w.WriteHeader(status)
		return session, false
	}
	return session, true
}

// mutator authenticates a state-changing request: origin, session and CSRF.
func (h *healthHandler) mutator(w http.ResponseWriter, r *http.Request) (sqlc.FindActiveSessionByTokenHashRow, bool) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return projectAccess{}, false
	}
	if !found {
		w.WriteHeader(http.StatusNotFound)
		return projectAccess{}, false
	}
	return access, true
}

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func optionalUUID(id *openapi_types.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return pgUUID(uuid.UUID(*id))
}

func uuidFrom(id openapi_types.UUID) uuid.UUID { return uuid.UUID(id) }

func fromPG(id pgtype.UUID) openapi_types.UUID { return openapi_types.UUID(uuid.UUID(id.Bytes)) }

func isConstraintViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && (pgErr.Code == "23503" || pgErr.Code == "23514" || pgErr.Code == "23505")
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// projectFields is the common shape of a project row, whichever query produced it.
type projectFields struct {
	ID                                     pgtype.UUID
	Name, Description, Color, Icon         string
	Version, ContentRevision               int32
	Manager, Encrypted, Archived           bool
	NameEnc, DescriptionEnc                []byte
	ContentAuthorID, ContentSignerDeviceID pgtype.UUID
	Permissions                            []string
}

func toProject(f projectFields) gen.Project {
	project := gen.Project{
		Id: fromPG(f.ID), Name: f.Name, Description: f.Description, Color: f.Color, Icon: f.Icon, Version: int(f.Version),
		IsManager: f.Manager, Encrypted: f.Encrypted, Archived: &f.Archived, ContentRevision: int(f.ContentRevision),
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
		Archived: p.Archived, Encrypted: p.Encrypted, NameEnc: p.NameEnc, DescriptionEnc: p.DescriptionEnc, ContentRevision: p.ContentRevision,
		ContentAuthorID: p.ContentAuthorID, ContentSignerDeviceID: p.ContentSignerDeviceID,
	}
}

func (h *healthHandler) ListProjects(w http.ResponseWriter, r *http.Request, params gen.ListProjectsParams) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := sqlc.New(h.auth.pool).ListProjectsForAccount(ctx, sqlc.ListProjectsForAccountParams{AccountID: session.AccountID, IncludeArchived: params.IncludeArchived != nil && *params.IncludeArchived})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	projects := make([]gen.Project, 0, len(rows))
	for _, row := range rows {
		projects = append(projects, toProject(projectFields{
			ID: row.ID, Name: row.Name, Description: row.Description, Color: row.Color, Icon: row.Icon, Version: row.Version, Manager: row.IsManager,
			Archived: row.Archived, Encrypted: row.Encrypted, NameEnc: row.NameEnc, DescriptionEnc: row.DescriptionEnc, ContentRevision: row.ContentRevision,
			ContentAuthorID: row.ContentAuthorID, ContentSignerDeviceID: row.ContentSignerDeviceID,
			Permissions: work.Access{Kind: row.MembershipKind, Manager: row.IsManager, External: row.ExternalPermissions}.Permissions(),
		}))
	}
	writeJSON(w, http.StatusOK, projects)
}

func (h *healthHandler) CreateProject(w http.ResponseWriter, r *http.Request) {
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
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	membership, err := q.GetOrganizationMembershipForAccount(ctx, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	project, err := q.CreateProject(ctx, sqlc.CreateProjectParams{
		OrganizationID: membership.OrganizationID, Name: payload.Name, Description: description,
		Color: color, Icon: "folder", CreatedBy: session.AccountID,
	})
	if isConstraintViolation(err) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if err = q.AddProjectMember(ctx, sqlc.AddProjectMemberParams{ProjectID: project.ID, AccountID: session.AccountID, IsManager: true}); err == nil {
		err = q.CreateExternalProjectPolicy(ctx, project.ID)
	}
	if err == nil {
		_, err = q.CreateConversation(ctx, sqlc.CreateConversationParams{ProjectID: project.ID, Name: "geral"})
	}
	for index, column := range defaultColumns {
		if err != nil {
			break
		}
		_, err = q.CreateBoardColumn(ctx, sqlc.CreateBoardColumnParams{
			ProjectID: project.ID, Name: column.name, Position: int32(index), Category: column.category,
		})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusCreated, toProject(fieldsOf(project, work.Access{Kind: "internal", Manager: true})))
}

func (h *healthHandler) GetProject(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, toProject(fieldsOf(project, access.access)))
}

func (h *healthHandler) ListProjectMembers(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
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

func (h *healthHandler) AddProjectMember(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
	if !access.access.Manager {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	// A project manager never promotes an external member to manager.
	manager := payload.IsManager != nil && *payload.IsManager && target.MembershipKind == "internal"
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	inTx := sqlc.New(tx)
	err = inTx.AddProjectMember(ctx, sqlc.AddProjectMemberParams{ProjectID: pgUUID(projectId), AccountID: target.AccountID, IsManager: manager})
	if err == nil {
		err = refreshProjectDomains(ctx, inTx, pgUUID(projectId))
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
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

func (h *healthHandler) GetExternalPolicy(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, toPolicy(policy.Permissions, policy.Version))
}

func (h *healthHandler) UpdateExternalPolicy(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	access, ok := loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID)
	if !ok {
		return
	}
	if !access.access.Manager {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	policy, err := q.UpdateExternalProjectPolicy(ctx, sqlc.UpdateExternalProjectPolicyParams{
		ProjectID: pgUUID(projectId), Permissions: permissions, Version: int32(payload.Version),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err == nil {
		var members []pgtype.UUID
		if members, err = projectRecipients(ctx, q, pgUUID(projectId), ""); err == nil {
			err = emitEvent(ctx, q, members, eventSpec{Type: "policy.changed", ResourceID: pgUUID(projectId), Version: policy.Version, ProjectID: pgUUID(projectId)})
		}
		if err == nil {
			err = refreshProjectDomains(ctx, q, pgUUID(projectId))
		}
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, toPolicy(policy.Permissions, policy.Version))
}

func (h *healthHandler) ListBoardColumns(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
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

func (h *healthHandler) ListWorkItems(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	items := make([]gen.WorkItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, toWorkItem(row))
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *healthHandler) CreateWorkItem(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
	kind := string(payload.Kind)
	if (kind == "task") == (payload.ParentId != nil) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	access, ok := loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID)
	if !ok {
		return
	}
	if !access.access.Can(work.WorkRead) || !access.access.Can(work.WorkCreate) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if access.archived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	var (
		writer *encContext
		fail   *encFailure
	)
	if encrypted {
		var signerID *pgtype.UUID
		if payload.SignerDeviceId != nil {
			signerID = optionalUUIDValue(pgUUID(uuidFrom(*payload.SignerDeviceId)))
		}
		writer, fail, err = prepareEncrypted(ctx, q, session.AccountID, pgUUID(projectId), "work", signerID)
		if err == nil && fail == nil {
			id := pgUUID(uuidFrom(*payload.Id))
			if fail = writer.verify(session.AccountID, workItemResource(id, "title"), 1, string(*payload.TitleEnc)); fail == nil {
				fail = writer.verify(session.AccountID, workItemResource(id, "desc"), 1, string(*payload.DescriptionEnc))
			}
		}
	} else {
		fail, err = requirePlaintextAllowed(ctx, q, pgUUID(projectId), "work")
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if fail != nil {
		fail.write(w)
		return
	}
	title := ""
	if payload.Title != nil {
		title = *payload.Title
	}
	params := sqlc.CreateWorkItemParams{
		ProjectID: pgUUID(projectId), Kind: kind, ParentID: optionalUUID(payload.ParentId), Title: title,
		AssigneeID: optionalUUID(payload.AssigneeId), Priority: "normal", CreatedBy: session.AccountID,
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
	} else {
		columns, listErr := q.ListBoardColumns(ctx, pgUUID(projectId))
		if listErr != nil || len(columns) == 0 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		params.ColumnID = columns[0].ID
		for _, column := range columns {
			if column.Category == "todo" {
				params.ColumnID = column.ID
				break
			}
		}
	}
	var item sqlc.WorkItem
	if encrypted {
		titleEnc, _ := unb64(string(*payload.TitleEnc), 0)
		descriptionEnc, _ := unb64(string(*payload.DescriptionEnc), 0)
		item, err = q.CreateEncryptedWorkItem(ctx, sqlc.CreateEncryptedWorkItemParams{
			ID: pgUUID(uuidFrom(*payload.Id)), ProjectID: params.ProjectID, Kind: kind, ParentID: params.ParentID,
			AssigneeID: params.AssigneeID, DueDate: params.DueDate, Priority: params.Priority, ColumnID: params.ColumnID,
			CreatedBy: session.AccountID, TitleEnc: titleEnc, DescriptionEnc: descriptionEnc, ContentSignerDeviceID: writer.signer.ID,
		})
	} else {
		item, err = q.CreateWorkItem(ctx, params)
	}
	if isUniqueViolation(err) {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if isConstraintViolation(err) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err == nil {
		err = emitWorkItemChanged(ctx, q, item)
	}
	if err == nil {
		err = notifyAssignment(ctx, q, item, session.AccountID, pgtype.UUID{})
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusCreated, toWorkItem(item))
}

func (h *healthHandler) UpdateWorkItem(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
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
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	// Lock the row first; authorization is checked on the locked row's project.
	item, err := q.GetWorkItemForUpdate(ctx, pgUUID(workItemId))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	access, ok := loadAccess(ctx, w, q, item.ProjectID, session.AccountID)
	if !ok {
		return
	}
	editing := payload.Title != nil || payload.Description != nil || payload.Priority != nil ||
		payload.AssigneeId != nil || payload.ClearAssignee != nil || payload.DueDate != nil || payload.ClearDueDate != nil ||
		payload.EpicId != nil || payload.ClearEpic != nil || encContent
	moving := payload.ColumnId != nil
	archiving := payload.Archived != nil
	planning := payload.SprintId != nil || payload.ClearSprint != nil
	if !access.access.Can(work.WorkRead) ||
		(editing && !access.access.Can(work.WorkEdit)) ||
		(moving && !access.access.Can(work.WorkMove)) ||
		(archiving && !access.access.Can(work.WorkArchive)) ||
		(planning && !access.access.Can(work.PlanningEdit)) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if access.archived || int32(payload.Version) != item.Version {
		w.WriteHeader(http.StatusConflict)
		return
	}

	var writer *encContext
	if encContent {
		var fail *encFailure
		revision := int32(*payload.ContentRevision)
		writer, fail, err = prepareEncrypted(ctx, q, session.AccountID, item.ProjectID, "work", optionalUUIDValue(pgUUID(uuidFrom(*payload.SignerDeviceId))))
		if err == nil && fail == nil && revision != item.ContentRevision+1 {
			fail = &encFailure{http.StatusConflict, gen.ApiErrorCodeBadRevision}
		}
		if err == nil && fail == nil {
			if fail = writer.verify(session.AccountID, workItemResource(item.ID, "title"), revision, *payload.TitleEnc); fail == nil {
				fail = writer.verify(session.AccountID, workItemResource(item.ID, "desc"), revision, *payload.DescriptionEnc)
			}
		}
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if fail != nil {
			fail.write(w)
			return
		}
	} else if payload.Title != nil || payload.Description != nil {
		fail, planErr := requirePlaintextAllowed(ctx, q, item.ProjectID, "work")
		if planErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if fail != nil {
			fail.write(w)
			return
		}
	}

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
	if payload.ClearSprint != nil && *payload.ClearSprint {
		params.SetSprint = true
	} else if payload.SprintId != nil {
		organizationID, orgErr := q.GetProjectOrganization(ctx, item.ProjectID)
		sprint, sprintErr := q.GetSprint(ctx, pgUUID(uuidFrom(*payload.SprintId)))
		if orgErr != nil || sprintErr != nil || sprint.OrganizationID != organizationID || sprint.State == "closed" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		params.SetSprint, params.SprintID = true, sprint.ID
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

	if moving {
		target, moveErr := q.GetBoardColumn(ctx, sqlc.GetBoardColumnParams{ID: pgUUID(uuid.UUID(*payload.ColumnId)), ProjectID: item.ProjectID})
		if errors.Is(moveErr, pgx.ErrNoRows) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if moveErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		params.ColumnID = target.ID
		if status := h.applyMoveRules(ctx, q, item, target, payload.CompleteSubtasks != nil && *payload.CompleteSubtasks); status != 0 {
			w.WriteHeader(status)
			return
		}
	}

	updated, err := q.UpdateWorkItem(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if isConstraintViolation(err) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err == nil && encContent {
		titleEnc, _ := unb64(*payload.TitleEnc, 0)
		descriptionEnc, _ := unb64(*payload.DescriptionEnc, 0)
		var changed int64
		changed, err = q.SetWorkItemContent(ctx, sqlc.SetWorkItemContentParams{
			ID: item.ID, TitleEnc: titleEnc, DescriptionEnc: descriptionEnc, ContentRevision: int32(*payload.ContentRevision),
			ContentAuthorID: session.AccountID, ContentSignerDeviceID: writer.signer.ID,
		})
		if err == nil && changed == 0 {
			w.WriteHeader(http.StatusConflict)
			return
		}
		if err == nil {
			updated, err = q.GetWorkItem(ctx, item.ID)
		}
	}
	if err == nil {
		err = emitWorkItemChanged(ctx, q, updated)
	}
	if err == nil {
		err = notifyAssignment(ctx, q, updated, session.AccountID, item.AssigneeID)
	}
	if err == nil && updated.AssigneeID.Valid && updated.AssigneeID != item.AssigneeID {
		// Whoever takes an activity follows it from then on.
		err = q.FollowWorkItem(ctx, sqlc.FollowWorkItemParams{WorkItemID: updated.ID, AccountID: updated.AssigneeID})
	}
	if err == nil && moving {
		err = notifyFollowers(ctx, q, updated, session.AccountID)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, toWorkItem(updated))
}

// applyMoveRules enforces the completion rules of SPEC 6.5 inside the caller's
// transaction. It returns a non-zero status when the move must be rejected.
func (h *healthHandler) applyMoveRules(ctx context.Context, q *sqlc.Queries, item sqlc.WorkItem, target sqlc.BoardColumn, completeSubtasks bool) int {
	current, err := q.GetBoardColumn(ctx, sqlc.GetBoardColumnParams{ID: item.ColumnID, ProjectID: item.ProjectID})
	if err != nil {
		return http.StatusServiceUnavailable
	}
	switch {
	case item.Kind == "task" && target.Category == "done" && current.Category != "done":
		open, listErr := q.ListOpenSubtasks(ctx, item.ID)
		if listErr != nil {
			return http.StatusServiceUnavailable
		}
		if len(open) > 0 && !completeSubtasks {
			return http.StatusConflict
		}
		for _, subtaskID := range open {
			if err = q.MoveWorkItemToColumn(ctx, sqlc.MoveWorkItemToColumnParams{ID: subtaskID, ColumnID: target.ID}); err != nil {
				return http.StatusServiceUnavailable
			}
		}
	case item.Kind == "task" && current.Category == "done" && target.Category != "done":
		if item.EpicID.Valid {
			if err = q.ReopenEpic(ctx, item.EpicID); err != nil {
				return http.StatusServiceUnavailable
			}
		}
	case item.Kind == "subtask" && current.Category == "done" && target.Category != "done":
		parent, parentErr := q.GetWorkItemForUpdate(ctx, item.ParentID)
		if parentErr != nil {
			return http.StatusServiceUnavailable
		}
		parentColumn, columnErr := q.GetBoardColumn(ctx, sqlc.GetBoardColumnParams{ID: parent.ColumnID, ProjectID: parent.ProjectID})
		if columnErr != nil {
			return http.StatusServiceUnavailable
		}
		if parentColumn.Category == "done" {
			if parent.EpicID.Valid {
				if err = q.ReopenEpic(ctx, parent.EpicID); err != nil {
					return http.StatusServiceUnavailable
				}
			}
			reopen, reopenErr := q.FirstColumnForReopen(ctx, item.ProjectID)
			if reopenErr != nil {
				return http.StatusServiceUnavailable
			}
			if err = q.MoveWorkItemToColumn(ctx, sqlc.MoveWorkItemToColumnParams{ID: parent.ID, ColumnID: reopen}); err != nil {
				return http.StatusServiceUnavailable
			}
		}
	}
	return 0
}

// workItemAccess resolves an item and the caller's access without leaking the
// existence of items in projects the caller cannot see.
func (h *healthHandler) workItemAccess(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, itemID gen.WorkItemId, accountID pgtype.UUID) (sqlc.WorkItem, projectAccess, bool) {
	item, err := q.GetWorkItem(ctx, pgUUID(itemID))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return item, projectAccess{}, false
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return item, projectAccess{}, false
	}
	access, ok := loadAccess(ctx, w, q, item.ProjectID, accountID)
	return item, access, ok
}

func (h *healthHandler) ListWorkItemComments(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
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

func (h *healthHandler) CreateWorkItemComment(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
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
		commentID := pgUUID(uuidFrom(*payload.Id))
		writer, fail, prepErr := prepareEncrypted(ctx, q, session.AccountID, item.ProjectID, "work", optionalUUIDValue(pgUUID(uuidFrom(*payload.SignerDeviceId))))
		if prepErr == nil && fail == nil {
			fail = writer.verify(session.AccountID, commentResource(commentID), 1, *payload.BodyEnc)
		}
		if prepErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if fail != nil {
			fail.write(w)
			return
		}
		bodyEnc, _ := unb64(*payload.BodyEnc, 0)
		comment, err = q.CreateEncryptedComment(ctx, sqlc.CreateEncryptedCommentParams{
			ID: commentID, WorkItemID: item.ID, AuthorID: session.AccountID, BodyEnc: bodyEnc, ContentSignerDeviceID: writer.signer.ID,
		})
	} else {
		fail, planErr := requirePlaintextAllowed(ctx, q, item.ProjectID, "work")
		if planErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if fail != nil {
			fail.write(w)
			return
		}
		comment, err = q.CreateWorkItemComment(ctx, sqlc.CreateWorkItemCommentParams{WorkItemID: item.ID, AuthorID: session.AccountID, Body: *payload.Body})
	}
	if isUniqueViolation(err) {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if isConstraintViolation(err) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
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

// EncryptComment migrates the author's own legacy plaintext comment: the
// plaintext is erased in the same statement that stores the envelope.
func (h *healthHandler) EncryptComment(w http.ResponseWriter, r *http.Request, commentId openapi_types.UUID) {
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
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	comment, err := q.GetWorkItemComment(ctx, pgUUID(uuidFrom(commentId)))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	item, err := q.GetWorkItem(ctx, comment.WorkItemID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	access, ok := loadAccess(ctx, w, q, item.ProjectID, session.AccountID)
	if !ok {
		return
	}
	if comment.AuthorID != session.AccountID || !access.access.Can(work.WorkRead) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if comment.Encrypted || access.archived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	writer, fail, err := prepareEncrypted(ctx, q, session.AccountID, item.ProjectID, "work", optionalUUIDValue(pgUUID(uuidFrom(payload.SignerDeviceId))))
	if err == nil && fail == nil {
		fail = writer.verify(session.AccountID, commentResource(comment.ID), 1, payload.BodyEnc)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if fail != nil {
		fail.write(w)
		return
	}
	bodyEnc, _ := unb64(payload.BodyEnc, 0)
	if _, err = q.SetCommentContent(ctx, sqlc.SetCommentContentParams{ID: comment.ID, BodyEnc: bodyEnc, ContentSignerDeviceID: writer.signer.ID}); err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// UpdateProject replaces a project's plaintext name and description with their
// encrypted form (managers only). There is no plaintext rename: once the
// project has a key, it never has one again.
func (h *healthHandler) UpdateProject(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	project, err := q.GetProjectForUpdate(ctx, pgUUID(projectId))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	access, ok := loadAccess(ctx, w, q, project.ID, session.AccountID)
	if !ok {
		return
	}
	if !access.access.Manager {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	revision := int32(payload.ContentRevision)
	writer, fail, err := prepareEncrypted(ctx, q, session.AccountID, project.ID, "work", optionalUUIDValue(pgUUID(uuidFrom(payload.SignerDeviceId))))
	if err == nil && fail == nil && revision != project.ContentRevision+1 {
		fail = &encFailure{http.StatusConflict, gen.ApiErrorCodeBadRevision}
	}
	if err == nil && fail == nil {
		if fail = writer.verify(session.AccountID, projectResource(project.ID, "name"), revision, payload.NameEnc); fail == nil {
			fail = writer.verify(session.AccountID, projectResource(project.ID, "desc"), revision, payload.DescriptionEnc)
		}
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if fail != nil {
		fail.write(w)
		return
	}
	nameEnc, _ := unb64(payload.NameEnc, 0)
	descriptionEnc, _ := unb64(payload.DescriptionEnc, 0)
	changed, err := q.SetProjectContent(ctx, sqlc.SetProjectContentParams{
		ID: project.ID, NameEnc: nameEnc, DescriptionEnc: descriptionEnc, ContentRevision: revision,
		ContentAuthorID: session.AccountID, ContentSignerDeviceID: writer.signer.ID,
	})
	if err == nil && changed == 0 {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err == nil {
		err = announceProjectChanged(ctx, q, project.ID)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
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
