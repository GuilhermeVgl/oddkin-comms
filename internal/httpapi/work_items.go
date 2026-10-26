package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

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

func (h *workAPI) ListWorkItems(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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

func (h *workAPI) CreateWorkItem(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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

func (h *workAPI) UpdateWorkItem(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
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
func (h *workAPI) workItemUpdateParams(ctx context.Context, q *sqlc.Queries, item sqlc.WorkItem, payload gen.UpdateWorkItemRequest) (sqlc.UpdateWorkItemParams, error) {
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
func (h *workAPI) applyMoveRules(ctx context.Context, q *sqlc.Queries, item sqlc.WorkItem, target sqlc.BoardColumn, completeSubtasks bool) error {
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
func (h *workAPI) reopenParentOfSubtask(ctx context.Context, q *sqlc.Queries, item sqlc.WorkItem) error {
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
func (h *workAPI) workItemAccess(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, itemID gen.WorkItemId, accountID pgtype.UUID) (sqlc.WorkItem, projectAccess, bool) {
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
