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
	var sprint sqlc.Sprint
	if encrypted {
		sprint, err = insertEncryptedSprint(ctx, w, q, session.AccountID, membership.OrganizationID, domain, found, payload)
	} else {
		sprint, err = insertPlainSprint(ctx, w, q, session.AccountID, membership.OrganizationID, domain, found, payload)
	}
	switch {
	case errors.Is(err, errResponded):
	case isUniqueViolation(err):
		w.WriteHeader(http.StatusConflict)
	case isConstraintViolation(err):
		w.WriteHeader(http.StatusBadRequest)
	case err != nil:
		serverError(w, r, err)
	default:
		writeJSON(w, http.StatusCreated, toSprint(sprint))
	}
}

// insertEncryptedSprint stores a sprint whose name and goal arrive as envelopes
// signed by the author's device. A refusal is written to w and reported as
// errResponded.
func insertEncryptedSprint(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, account, organizationID pgtype.UUID, domain sqlc.KeyDomain, found bool, payload gen.CreateSprintRequest) (sqlc.Sprint, error) {
	id := toPG(*payload.Id)
	writer, fail, err := prepareEncryptedWith(ctx, q, account, domain, found, optionalUUIDValue(toPG(*payload.SignerDeviceId)))
	if err != nil {
		return sqlc.Sprint{}, err
	}
	if fail == nil {
		if fail = writer.verify(account, sprintResource(id, "name"), 1, *payload.NameEnc); fail == nil {
			fail = writer.verify(account, sprintResource(id, "goal"), 1, *payload.GoalEnc)
		}
	}
	if fail != nil {
		fail.write(w)
		return sqlc.Sprint{}, errResponded
	}
	nameEnc, _ := unb64(*payload.NameEnc, 0)
	goalEnc, _ := unb64(*payload.GoalEnc, 0)
	return q.CreateEncryptedSprint(ctx, sqlc.CreateEncryptedSprintParams{
		ID: id, OrganizationID: organizationID, StartsOn: sprintDate(payload.StartsOn), EndsOn: sprintDate(payload.EndsOn), CreatedBy: account,
		NameEnc: nameEnc, GoalEnc: goalEnc, ContentSignerDeviceID: writer.signer.ID,
	})
}

// insertPlainSprint stores a sprint in the clear, which only an organization
// that has not started encrypting sprints may still do.
func insertPlainSprint(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, account, organizationID pgtype.UUID, domain sqlc.KeyDomain, found bool, payload gen.CreateSprintRequest) (sqlc.Sprint, error) {
	if found && domain.CurrentGeneration > 0 {
		(&encFailure{http.StatusConflict, gen.ApiErrorCodeEncryptionRequired}).write(w)
		return sqlc.Sprint{}, errResponded
	}
	goal := ""
	if payload.Goal != nil {
		goal = *payload.Goal
	}
	return q.CreateSprint(ctx, sqlc.CreateSprintParams{
		OrganizationID: organizationID, Name: *payload.Name, Goal: goal, StartsOn: sprintDate(payload.StartsOn), EndsOn: sprintDate(payload.EndsOn), CreatedBy: account,
	})
}

func sprintDate(date openapi_types.Date) pgtype.Date {
	return pgtype.Date{Time: date.Time, Valid: true}
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
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		visible, ok := visibleSprint(ctx, w, q, sprintId, session.AccountID)
		if !ok {
			return errResponded
		}
		sprint, err := q.GetSprintForUpdate(ctx, visible.ID)
		if err != nil {
			return err
		}
		domain, found, err := sprintDomain(ctx, q, sprint.OrganizationID)
		if err != nil {
			return err
		}
		revision := int32(payload.ContentRevision)
		writer, fail, err := prepareEncryptedWith(ctx, q, session.AccountID, domain, found, optionalUUIDValue(toPG(payload.SignerDeviceId)))
		if err != nil {
			return err
		}
		if fail == nil && revision != sprint.ContentRevision+1 {
			fail = &encFailure{http.StatusConflict, gen.ApiErrorCodeBadRevision}
		}
		if fail == nil {
			if fail = writer.verify(session.AccountID, sprintResource(sprint.ID, "name"), revision, payload.NameEnc); fail == nil {
				fail = writer.verify(session.AccountID, sprintResource(sprint.ID, "goal"), revision, payload.GoalEnc)
			}
		}
		if fail != nil {
			fail.write(w)
			return errResponded
		}
		nameEnc, _ := unb64(payload.NameEnc, 0)
		goalEnc, _ := unb64(payload.GoalEnc, 0)
		changed, err := q.SetSprintContent(ctx, sqlc.SetSprintContentParams{
			ID: sprint.ID, NameEnc: nameEnc, GoalEnc: goalEnc, ContentRevision: revision,
			ContentAuthorID: session.AccountID, ContentSignerDeviceID: writer.signer.ID,
		})
		if err != nil {
			return err
		}
		if changed == 0 {
			return statusError(http.StatusConflict)
		}
		internal, err := q.ListInternalAccounts(ctx, sprint.OrganizationID)
		if err != nil {
			return err
		}
		return emitEvent(ctx, q, internal, eventSpec{Type: "sprint.changed", ResourceID: sprint.ID})
	})
	if respondError(w, r, err) {
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
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		visible, ok := visibleSprint(ctx, w, q, sprintId, session.AccountID)
		if !ok {
			return errResponded
		}
		sprint, err := q.GetSprintForUpdate(ctx, visible.ID)
		if err != nil {
			return err
		}
		if sprint.State != "active" {
			return statusError(http.StatusConflict)
		}
		tasks, err := q.ListSprintTasksForClose(ctx, sqlc.ListSprintTasksForCloseParams{SprintID: sprint.ID, AccountID: session.AccountID})
		if err != nil {
			return err
		}
		decisions, err := indexCloseDecisions(payload)
		if err != nil {
			return err
		}
		needsNext, err := checkCloseDecisions(tasks, decisions)
		if err != nil {
			return err
		}
		var destination pgtype.UUID
		if needsNext {
			if destination, err = nextSprintFor(ctx, q, sprint, payload.DestinationSprintId); err != nil {
				return err
			}
		}
		if err = recordCloseOutcomes(ctx, q, sprint.ID, tasks, decisions, destination); err != nil {
			return err
		}
		return q.CloseSprint(ctx, sprint.ID)
	})
	if respondError(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// closeDecision is what the administrator chose for one unfinished task.
type closeDecision struct {
	version     int32
	destination string
}

// indexCloseDecisions keys the decisions by work item; naming a task twice is a
// bad request.
func indexCloseDecisions(payload gen.CloseSprintRequest) (map[pgtype.UUID]closeDecision, error) {
	decisions := make(map[pgtype.UUID]closeDecision, len(payload.Decisions))
	for _, entry := range payload.Decisions {
		id := toPG(entry.WorkItemId)
		if _, duplicate := decisions[id]; duplicate {
			return nil, statusError(http.StatusBadRequest)
		}
		decisions[id] = closeDecision{version: int32(entry.Version), destination: string(entry.Destination)}
	}
	return decisions, nil
}

// checkCloseDecisions requires exactly one current decision for every
// unfinished task, none of them hidden from the administrator. It reports
// whether any task is carried to the next sprint.
func checkCloseDecisions(tasks []sqlc.ListSprintTasksForCloseRow, decisions map[pgtype.UUID]closeDecision) (bool, error) {
	needsNext := false
	pending := 0
	for _, task := range tasks {
		if task.Finished {
			continue
		}
		pending++
		if !task.Accessible {
			return false, statusError(http.StatusConflict)
		}
		chosen, present := decisions[task.ID]
		if !present {
			return false, statusError(http.StatusBadRequest)
		}
		if chosen.version != task.Version {
			return false, statusError(http.StatusConflict)
		}
		needsNext = needsNext || chosen.destination == "next"
	}
	if pending != len(decisions) {
		return false, statusError(http.StatusBadRequest)
	}
	return needsNext, nil
}

// nextSprintFor resolves the planned sprint of the same organization that
// receives the carried tasks.
func nextSprintFor(ctx context.Context, q *sqlc.Queries, closing sqlc.Sprint, requested *openapi_types.UUID) (pgtype.UUID, error) {
	if requested == nil {
		return pgtype.UUID{}, statusError(http.StatusBadRequest)
	}
	next, err := q.GetSprint(ctx, toPG(*requested))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (next.OrganizationID != closing.OrganizationID || next.State != "planned")) {
		return pgtype.UUID{}, statusError(http.StatusBadRequest)
	}
	if err != nil {
		return pgtype.UUID{}, err
	}
	return next.ID, nil
}

// recordCloseOutcomes moves each unfinished task as decided and records how
// every task of the sprint ended.
func recordCloseOutcomes(ctx context.Context, q *sqlc.Queries, sprintID pgtype.UUID, tasks []sqlc.ListSprintTasksForCloseRow, decisions map[pgtype.UUID]closeDecision, destination pgtype.UUID) error {
	for _, task := range tasks {
		outcome := "completed"
		if !task.Finished {
			target := pgtype.UUID{}
			outcome = "backlog"
			if decisions[task.ID].destination == "next" {
				target, outcome = destination, "carried"
			}
			if err := q.SetTaskSprint(ctx, sqlc.SetTaskSprintParams{ID: task.ID, SprintID: target}); err != nil {
				return err
			}
		}
		if err := q.RecordSprintItem(ctx, sqlc.RecordSprintItemParams{SprintID: sprintID, WorkItemID: task.ID, Outcome: outcome}); err != nil {
			return err
		}
	}
	return nil
}
