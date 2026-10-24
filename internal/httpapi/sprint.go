package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func toSprint(sprint sqlc.Sprint) gen.Sprint {
	return gen.Sprint{
		Id: fromPG(sprint.ID), Name: sprint.Name, Goal: sprint.Goal,
		StartsOn: openapi_types.Date{Time: sprint.StartsOn.Time}, EndsOn: openapi_types.Date{Time: sprint.EndsOn.Time},
		State: gen.SprintState(sprint.State), Version: int(sprint.Version),
	}
}

func (h *healthHandler) ListSprints(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := sqlc.New(h.auth.pool).ListSprintsForAccount(ctx, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	sprints := make([]gen.Sprint, 0, len(rows))
	for _, row := range rows {
		sprints = append(sprints, toSprint(row))
	}
	writeJSON(w, http.StatusOK, sprints)
}

func (h *healthHandler) CreateSprint(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var payload gen.CreateSprintRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	if payload.StartsOn.After(payload.EndsOn.Time) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	goal := ""
	if payload.Goal != nil {
		goal = *payload.Goal
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	membership, err := q.GetOrganizationMembershipForAccount(ctx, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	sprint, err := q.CreateSprint(ctx, sqlc.CreateSprintParams{
		OrganizationID: membership.OrganizationID, Name: payload.Name, Goal: goal,
		StartsOn: pgtype.Date{Time: payload.StartsOn.Time, Valid: true}, EndsOn: pgtype.Date{Time: payload.EndsOn.Time, Valid: true},
		CreatedBy: session.AccountID,
	})
	if isConstraintViolation(err) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusCreated, toSprint(sprint))
}

// visibleSprint answers 404 for sprints the account cannot see, matching the
// projection used by ListSprints.
func visibleSprint(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, sprintID openapi_types.UUID, accountID pgtype.UUID) (sqlc.Sprint, bool) {
	rows, err := q.ListSprintsForAccount(ctx, accountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return sqlc.Sprint{}, false
	}
	for _, row := range rows {
		if row.ID == pgUUID(uuidFrom(sprintID)) {
			return row, true
		}
	}
	w.WriteHeader(http.StatusNotFound)
	return sqlc.Sprint{}, false
}

func (h *healthHandler) ListSprintWorkItems(w http.ResponseWriter, r *http.Request, sprintId gen.SprintId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	items := make([]gen.WorkItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, toWorkItem(row))
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *healthHandler) StartSprint(w http.ResponseWriter, r *http.Request, sprintId gen.SprintId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, toSprint(started))
}

func (h *healthHandler) GetSprintClosePreview(w http.ResponseWriter, r *http.Request, sprintId gen.SprintId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	readable, err := q.ListSprintTasksForAccount(ctx, sqlc.ListSprintTasksForAccountParams{SprintID: sprint.ID, AccountID: session.AccountID})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
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

func (h *healthHandler) CloseSprint(w http.ResponseWriter, r *http.Request, sprintId gen.SprintId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	type decision struct {
		version     int32
		destination string
	}
	decisions := make(map[pgtype.UUID]decision, len(payload.Decisions))
	for _, entry := range payload.Decisions {
		id := pgUUID(uuidFrom(entry.WorkItemId))
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
		next, nextErr := q.GetSprint(ctx, pgUUID(uuidFrom(*payload.DestinationSprintId)))
		if errors.Is(nextErr, pgx.ErrNoRows) || (nextErr == nil && (next.OrganizationID != sprint.OrganizationID || next.State != "planned")) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if nextErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
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
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
	}
	if err = q.CloseSprint(ctx, sprint.ID); err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
