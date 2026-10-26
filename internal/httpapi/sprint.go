package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func toSprint(sprint sqlc.Sprint) gen.Sprint {
	response := gen.Sprint{
		Id: fromPG(sprint.ID), Name: sprint.Name, Goal: sprint.Goal,
		StartsOn: openapi_types.Date{Time: sprint.StartsOn.Time}, EndsOn: openapi_types.Date{Time: sprint.EndsOn.Time},
		State: gen.SprintState(sprint.State), Version: int(sprint.Version),
		Encrypted: sprint.Encrypted, ContentRevision: int(sprint.ContentRevision),
	}
	if sprint.Encrypted {
		response.NameEnc, response.GoalEnc = blob(sprint.NameEnc), blob(sprint.GoalEnc)
		if sprint.ContentAuthorID.Valid {
			author := fromPG(sprint.ContentAuthorID)
			response.ContentAuthorId = &author
		}
		if sprint.ContentSignerDeviceID.Valid {
			signer := fromPG(sprint.ContentSignerDeviceID)
			response.SignerDeviceId = &signer
		}
	}
	return response
}

// sprintDomain returns the organization's sprint key domain, if any.
func sprintDomain(ctx context.Context, q *sqlc.Queries, organizationID pgtype.UUID) (sqlc.KeyDomain, bool, error) {
	domain, err := q.GetSprintKeyDomain(ctx, organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain, false, nil
	}
	return domain, err == nil, err
}

func (h *apiServer) ListSprints(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := sqlc.New(h.auth.pool).ListSprintsForAccount(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	sprints := make([]gen.Sprint, 0, len(rows))
	for _, row := range rows {
		sprints = append(sprints, toSprint(row))
	}
	writeJSON(w, http.StatusOK, sprints)
}

func (h *apiServer) CreateSprint(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var payload gen.CreateSprintRequest
	if !decodeJSONBodyLimit(w, r, &payload, contentBodyLimit) {
		return
	}
	encrypted := payload.NameEnc != nil || payload.GoalEnc != nil
	if payload.StartsOn.After(payload.EndsOn.Time) ||
		encrypted && (payload.NameEnc == nil || payload.GoalEnc == nil || payload.Id == nil || payload.SignerDeviceId == nil || payload.Name != nil || payload.Goal != nil) ||
		!encrypted && payload.Name == nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	membership, err := q.GetOrganizationMembershipForAccount(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	domain, found, err := sprintDomain(ctx, q, membership.OrganizationID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	starts := pgtype.Date{Time: payload.StartsOn.Time, Valid: true}
	ends := pgtype.Date{Time: payload.EndsOn.Time, Valid: true}
	var sprint sqlc.Sprint
	if encrypted {
		id := toPG(*payload.Id)
		writer, fail, prepErr := prepareEncryptedWith(ctx, q, session.AccountID, domain, found, optionalUUIDValue(toPG(*payload.SignerDeviceId)))
		if prepErr == nil && fail == nil {
			if fail = writer.verify(session.AccountID, sprintResource(id, "name"), 1, *payload.NameEnc); fail == nil {
				fail = writer.verify(session.AccountID, sprintResource(id, "goal"), 1, *payload.GoalEnc)
			}
		}
		if prepErr != nil {
			serverError(w, r, prepErr)
			return
		}
		if fail != nil {
			fail.write(w)
			return
		}
		nameEnc, _ := unb64(*payload.NameEnc, 0)
		goalEnc, _ := unb64(*payload.GoalEnc, 0)
		sprint, err = q.CreateEncryptedSprint(ctx, sqlc.CreateEncryptedSprintParams{
			ID: id, OrganizationID: membership.OrganizationID, StartsOn: starts, EndsOn: ends, CreatedBy: session.AccountID,
			NameEnc: nameEnc, GoalEnc: goalEnc, ContentSignerDeviceID: writer.signer.ID,
		})
	} else {
		if found && domain.CurrentGeneration > 0 {
			(&encFailure{http.StatusConflict, gen.ApiErrorCodeEncryptionRequired}).write(w)
			return
		}
		goal := ""
		if payload.Goal != nil {
			goal = *payload.Goal
		}
		sprint, err = q.CreateSprint(ctx, sqlc.CreateSprintParams{
			OrganizationID: membership.OrganizationID, Name: *payload.Name, Goal: goal, StartsOn: starts, EndsOn: ends, CreatedBy: session.AccountID,
		})
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
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, toSprint(sprint))
}

// UpdateSprint encrypts the name and goal of a sprint (administrators).
func (h *apiServer) UpdateSprint(w http.ResponseWriter, r *http.Request, sprintId gen.SprintId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var payload gen.UpdateSprintRequest
	if !decodeJSONBodyLimit(w, r, &payload, contentBodyLimit) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	visible, ok := visibleSprint(ctx, w, q, sprintId, session.AccountID)
	if !ok {
		return
	}
	sprint, err := q.GetSprintForUpdate(ctx, visible.ID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	domain, found, err := sprintDomain(ctx, q, sprint.OrganizationID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	revision := int32(payload.ContentRevision)
	writer, fail, err := prepareEncryptedWith(ctx, q, session.AccountID, domain, found, optionalUUIDValue(toPG(payload.SignerDeviceId)))
	if err == nil && fail == nil && revision != sprint.ContentRevision+1 {
		fail = &encFailure{http.StatusConflict, gen.ApiErrorCodeBadRevision}
	}
	if err == nil && fail == nil {
		if fail = writer.verify(session.AccountID, sprintResource(sprint.ID, "name"), revision, payload.NameEnc); fail == nil {
			fail = writer.verify(session.AccountID, sprintResource(sprint.ID, "goal"), revision, payload.GoalEnc)
		}
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	if fail != nil {
		fail.write(w)
		return
	}
	nameEnc, _ := unb64(payload.NameEnc, 0)
	goalEnc, _ := unb64(payload.GoalEnc, 0)
	changed, err := q.SetSprintContent(ctx, sqlc.SetSprintContentParams{
		ID: sprint.ID, NameEnc: nameEnc, GoalEnc: goalEnc, ContentRevision: revision,
		ContentAuthorID: session.AccountID, ContentSignerDeviceID: writer.signer.ID,
	})
	if err == nil && changed == 0 {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err == nil {
		var internal []pgtype.UUID
		if internal, err = q.ListInternalAccounts(ctx, sprint.OrganizationID); err == nil {
			err = emitEvent(ctx, q, internal, eventSpec{Type: "sprint.changed", ResourceID: sprint.ID})
		}
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// visibleSprint answers 404 for sprints the account cannot see, matching the
// projection used by ListSprints.
func visibleSprint(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, sprintID openapi_types.UUID, accountID pgtype.UUID) (sqlc.Sprint, bool) {
	rows, err := q.ListSprintsForAccount(ctx, accountID)
	if err != nil {
		serverError(w, nil, err)
		return sqlc.Sprint{}, false
	}
	for _, row := range rows {
		if row.ID == toPG(sprintID) {
			return row, true
		}
	}
	w.WriteHeader(http.StatusNotFound)
	return sqlc.Sprint{}, false
}

func (h *apiServer) ListSprintWorkItems(w http.ResponseWriter, r *http.Request, sprintId gen.SprintId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	sprint, ok := visibleSprint(ctx, w, q, sprintId, session.AccountID)
	if !ok {
		return
	}
	rows, err := q.ListSprintTasksForAccount(ctx, sqlc.ListSprintTasksForAccountParams{SprintID: sprint.ID, AccountID: session.AccountID})
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

func (h *apiServer) StartSprint(w http.ResponseWriter, r *http.Request, sprintId gen.SprintId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	sprint, ok := visibleSprint(ctx, w, q, sprintId, session.AccountID)
	if !ok {
		return
	}
	started, err := q.StartSprint(ctx, sprint.ID)
	if errors.Is(err, pgx.ErrNoRows) || isConstraintViolation(err) {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toSprint(started))
}

func (h *apiServer) GetSprintClosePreview(w http.ResponseWriter, r *http.Request, sprintId gen.SprintId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	sprint, ok := visibleSprint(ctx, w, q, sprintId, session.AccountID)
	if !ok {
		return
	}
	all, err := q.ListSprintTasksForClose(ctx, sqlc.ListSprintTasksForCloseParams{SprintID: sprint.ID, AccountID: session.AccountID})
	if err != nil {
		serverError(w, r, err)
		return
	}
	readable, err := q.ListSprintTasksForAccount(ctx, sqlc.ListSprintTasksForAccountParams{SprintID: sprint.ID, AccountID: session.AccountID})
	if err != nil {
		serverError(w, r, err)
		return
	}
	finished := make(map[pgtype.UUID]bool, len(all))
	blocked := false
	for _, task := range all {
		finished[task.ID] = task.Finished
		if !task.Finished && !task.Accessible {
			blocked = true
		}
	}
	preview := gen.SprintClosePreview{Completed: []gen.WorkItem{}, Pending: []gen.WorkItem{}, Blocked: blocked}
	for _, item := range readable {
		if finished[item.ID] {
			preview.Completed = append(preview.Completed, toWorkItem(item))
		} else {
			preview.Pending = append(preview.Pending, toWorkItem(item))
		}
	}
	writeJSON(w, http.StatusOK, preview)
}

func (h *apiServer) CloseSprint(w http.ResponseWriter, r *http.Request, sprintId gen.SprintId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var payload gen.CloseSprintRequest
	if !decodeJSONBodyLimit(w, r, &payload, 256<<10) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	sprint, ok := visibleSprint(ctx, w, q, sprintId, session.AccountID)
	if !ok {
		return
	}
	if sprint, err = q.GetSprintForUpdate(ctx, sprint.ID); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if sprint.State != "active" {
		w.WriteHeader(http.StatusConflict)
		return
	}
	tasks, err := q.ListSprintTasksForClose(ctx, sqlc.ListSprintTasksForCloseParams{SprintID: sprint.ID, AccountID: session.AccountID})
	if err != nil {
		serverError(w, r, err)
		return
	}
	type decision struct {
		version     int32
		destination string
	}
	decisions := make(map[pgtype.UUID]decision, len(payload.Decisions))
	for _, entry := range payload.Decisions {
		id := toPG(entry.WorkItemId)
		if _, duplicate := decisions[id]; duplicate {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		decisions[id] = decision{version: int32(entry.Version), destination: string(entry.Destination)}
	}
	needsNext := false
	pending := 0
	for _, task := range tasks {
		if task.Finished {
			continue
		}
		pending++
		if !task.Accessible {
			w.WriteHeader(http.StatusConflict)
			return
		}
		chosen, present := decisions[task.ID]
		if !present {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if chosen.version != task.Version {
			w.WriteHeader(http.StatusConflict)
			return
		}
		needsNext = needsNext || chosen.destination == "next"
	}
	if pending != len(decisions) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	var destination pgtype.UUID
	if needsNext {
		if payload.DestinationSprintId == nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		next, nextErr := q.GetSprint(ctx, toPG(*payload.DestinationSprintId))
		if errors.Is(nextErr, pgx.ErrNoRows) || (nextErr == nil && (next.OrganizationID != sprint.OrganizationID || next.State != "planned")) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if nextErr != nil {
			serverError(w, r, nextErr)
			return
		}
		destination = next.ID
	}
	for _, task := range tasks {
		outcome := "completed"
		if !task.Finished {
			chosen := decisions[task.ID]
			target := pgtype.UUID{}
			outcome = "backlog"
			if chosen.destination == "next" {
				target, outcome = destination, "carried"
			}
			err = q.SetTaskSprint(ctx, sqlc.SetTaskSprintParams{ID: task.ID, SprintID: target})
		}
		if err == nil {
			err = q.RecordSprintItem(ctx, sqlc.RecordSprintItemParams{SprintID: sprint.ID, WorkItemID: task.ID, Outcome: outcome})
		}
		if err != nil {
			serverError(w, r, err)
			return
		}
	}
	if err = q.CloseSprint(ctx, sprint.ID); err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
