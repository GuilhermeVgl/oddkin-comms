package httpapi

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	sqlc "github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

const maxColumnName = 60

func toBoardColumn(row sqlc.BoardColumn) gen.BoardColumn {
	return gen.BoardColumn{Id: fromPG(row.ID), Name: row.Name, Position: int(row.Position), Category: gen.BoardColumnCategory(row.Category)}
}

// boardKeepsItsEnds reports whether the board still has a column where work
// can be open and one where it is done, the two things the product relies on.
func boardKeepsItsEnds(columns []sqlc.BoardColumn) bool {
	open, done := false, false
	for _, column := range columns {
		if column.Category == "done" {
			done = true
		} else {
			open = true
		}
	}
	return open && done
}

func validColumnName(name string) (string, bool) {
	trimmed := strings.TrimSpace(name)
	return trimmed, trimmed != "" && utf8.RuneCountInString(trimmed) <= maxColumnName
}

// columnTx runs a managers-only change of a project's columns in one
// transaction, under a project lock so two managers cannot break the board's
// rules together, and announces it so open boards reload.
func (h *apiServer) columnTx(w http.ResponseWriter, r *http.Request, projectID gen.ProjectId, change func(ctx context.Context, q *sqlc.Queries) (status int, body any, err error)) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var (
		status int
		body   any
	)
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		access, ok := loadAccess(ctx, w, q, pgUUID(projectID), session.AccountID)
		if !ok {
			return errResponded
		}
		if !access.access.Manager {
			return statusError(http.StatusForbidden)
		}
		if access.archived {
			return statusError(http.StatusConflict)
		}
		if err := q.LockProject(ctx, pgUUID(projectID)); err != nil {
			return err
		}
		var err error
		if status, body, err = change(ctx, q); err != nil {
			return err
		}
		if status >= 400 {
			return statusError(status)
		}
		members, err := projectRecipients(ctx, q, pgUUID(projectID), "")
		if err != nil {
			return err
		}
		return emitEvent(ctx, q, members, eventSpec{Type: "project.changed", ResourceID: pgUUID(projectID), ProjectID: pgUUID(projectID)})
	})
	if respondError(w, r, err) {
		return
	}
	if body == nil {
		w.WriteHeader(status)
		return
	}
	writeJSON(w, status, body)
}

func (h *apiServer) CreateBoardColumn(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	var payload gen.CreateBoardColumnRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	name, valid := validColumnName(payload.Name)
	if !valid {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	h.columnTx(w, r, projectId, func(ctx context.Context, q *sqlc.Queries) (int, any, error) {
		position, err := q.NextBoardColumnPosition(ctx, pgUUID(projectId))
		if err != nil {
			return 0, nil, err
		}
		created, err := q.CreateBoardColumn(ctx, sqlc.CreateBoardColumnParams{
			ProjectID: pgUUID(projectId), Name: name, Position: position, Category: string(payload.Category),
		})
		if err != nil {
			return 0, nil, err
		}
		return http.StatusCreated, toBoardColumn(created), nil
	})
}

func (h *apiServer) UpdateBoardColumn(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId, columnId openapi_types.UUID) {
	var payload gen.UpdateBoardColumnRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	params := sqlc.UpdateBoardColumnParams{ID: toPG(columnId), ProjectID: pgUUID(projectId)}
	if payload.Name != nil {
		name, valid := validColumnName(*payload.Name)
		if !valid {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		params.Name = pgtype.Text{String: name, Valid: true}
	}
	if payload.Category != nil {
		params.Category = pgtype.Text{String: string(*payload.Category), Valid: true}
	}
	h.columnTx(w, r, projectId, func(ctx context.Context, q *sqlc.Queries) (int, any, error) {
		updated, err := q.UpdateBoardColumn(ctx, params)
		if errors.Is(err, pgx.ErrNoRows) {
			return http.StatusNotFound, nil, nil
		}
		if err != nil {
			return 0, nil, err
		}
		columns, err := q.ListBoardColumns(ctx, pgUUID(projectId))
		if err != nil {
			return 0, nil, err
		}
		if !boardKeepsItsEnds(columns) {
			// The transaction rolls back when this handler writes the status.
			return http.StatusBadRequest, nil, nil
		}
		return http.StatusOK, toBoardColumn(updated), nil
	})
}

func (h *apiServer) DeleteBoardColumn(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId, columnId openapi_types.UUID, params gen.DeleteBoardColumnParams) {
	id := toPG(columnId)
	h.columnTx(w, r, projectId, func(ctx context.Context, q *sqlc.Queries) (int, any, error) {
		if _, err := q.GetBoardColumn(ctx, sqlc.GetBoardColumnParams{ID: id, ProjectID: pgUUID(projectId)}); errors.Is(err, pgx.ErrNoRows) {
			return http.StatusNotFound, nil, nil
		} else if err != nil {
			return 0, nil, err
		}
		holding, err := q.CountWorkItemsInColumn(ctx, sqlc.CountWorkItemsInColumnParams{ColumnID: id, ProjectID: pgUUID(projectId)})
		if err != nil {
			return 0, nil, err
		}
		if holding > 0 {
			if params.MoveTo == nil || uuidFrom(*params.MoveTo) == uuidFrom(columnId) {
				return http.StatusBadRequest, nil, nil
			}
			destination := toPG(*params.MoveTo)
			if _, err = q.GetBoardColumn(ctx, sqlc.GetBoardColumnParams{ID: destination, ProjectID: pgUUID(projectId)}); errors.Is(err, pgx.ErrNoRows) {
				return http.StatusBadRequest, nil, nil
			} else if err != nil {
				return 0, nil, err
			}
			if err = q.MoveWorkItemsBetweenColumns(ctx, sqlc.MoveWorkItemsBetweenColumnsParams{ColumnID: id, ProjectID: pgUUID(projectId), ColumnID_2: destination}); err != nil {
				return 0, nil, err
			}
		}
		if _, err = q.DeleteBoardColumn(ctx, sqlc.DeleteBoardColumnParams{ID: id, ProjectID: pgUUID(projectId)}); err != nil {
			return 0, nil, err
		}
		remaining, err := q.ListBoardColumns(ctx, pgUUID(projectId))
		if err != nil {
			return 0, nil, err
		}
		if !boardKeepsItsEnds(remaining) {
			return http.StatusBadRequest, nil, nil
		}
		return http.StatusNoContent, nil, nil
	})
}

func (h *apiServer) ReorderBoardColumns(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	var payload gen.ReorderBoardColumnsRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	h.columnTx(w, r, projectId, func(ctx context.Context, q *sqlc.Queries) (int, any, error) {
		current, err := q.ListBoardColumns(ctx, pgUUID(projectId))
		if err != nil {
			return 0, nil, err
		}
		wanted := make([][16]byte, 0, len(payload.ColumnIds))
		for _, id := range payload.ColumnIds {
			wanted = append(wanted, uuidFrom(id))
		}
		have := make([][16]byte, 0, len(current))
		for _, row := range current {
			have = append(have, row.ID.Bytes)
		}
		slices.SortFunc(have, func(a, b [16]byte) int { return slices.Compare(a[:], b[:]) })
		sorted := slices.Clone(wanted)
		slices.SortFunc(sorted, func(a, b [16]byte) int { return slices.Compare(a[:], b[:]) })
		if !slices.Equal(have, sorted) {
			return http.StatusBadRequest, nil, nil
		}
		for position, id := range wanted {
			if err = q.SetBoardColumnPosition(ctx, sqlc.SetBoardColumnPositionParams{ID: pgUUID(id), ProjectID: pgUUID(projectId), Position: int32(position)}); err != nil {
				return 0, nil, err
			}
		}
		reordered, err := q.ListBoardColumns(ctx, pgUUID(projectId))
		if err != nil {
			return 0, nil, err
		}
		response := make([]gen.BoardColumn, 0, len(reordered))
		for _, row := range reordered {
			response = append(response, toBoardColumn(row))
		}
		return http.StatusOK, response, nil
	})
}

// RemoveProjectMember ends a person's access at once. The same transaction
// marks every key domain of the project for rotation, so what is written after
// this cannot be read by the person who left, and tells open clients to reload.
func (h *apiServer) RemoveProjectMember(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId, accountId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		access, ok := loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID)
		if !ok {
			return errResponded
		}
		if !access.access.Manager {
			return statusError(http.StatusForbidden)
		}
		if access.archived {
			return statusError(http.StatusConflict)
		}
		if err := q.LockProject(ctx, pgUUID(projectId)); err != nil {
			return err
		}
		target := toPG(accountId)
		targetAccess, found, err := lookupAccess(ctx, q, pgUUID(projectId), target)
		if err != nil {
			return err
		}
		if !found {
			return statusError(http.StatusNotFound)
		}
		if targetAccess.access.Manager {
			managers, err := q.CountProjectManagers(ctx, pgUUID(projectId))
			if err != nil {
				return err
			}
			if managers <= 1 {
				return statusError(http.StatusConflict)
			}
		}
		// The person is still a recipient here, so their clients hear about it too.
		recipients, err := projectRecipients(ctx, q, pgUUID(projectId), "")
		if err != nil {
			return err
		}
		if _, err = q.RemoveProjectMember(ctx, sqlc.RemoveProjectMemberParams{ProjectID: pgUUID(projectId), AccountID: target}); err != nil {
			return err
		}
		if err = emitEvent(ctx, q, recipients, eventSpec{Type: "project.changed", ResourceID: pgUUID(projectId), ProjectID: pgUUID(projectId)}); err != nil {
			return err
		}
		return refreshProjectDomains(ctx, q, pgUUID(projectId))
	})
	if respondError(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiServer) followAccess(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId, write bool) (sqlc.WorkItem, pgtype.UUID, bool) {
	var (
		session sqlc.FindActiveSessionByTokenHashRow
		ok      bool
	)
	if write {
		session, ok = h.mutator(w, r)
	} else {
		session, ok = h.reader(w, r)
	}
	if !ok {
		return sqlc.WorkItem{}, pgtype.UUID{}, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	item, access, ok := h.workItemAccess(ctx, w, sqlc.New(h.auth.pool), workItemId, session.AccountID)
	if !ok {
		return sqlc.WorkItem{}, pgtype.UUID{}, false
	}
	if !access.access.Can(work.WorkRead) {
		w.WriteHeader(http.StatusForbidden)
		return sqlc.WorkItem{}, pgtype.UUID{}, false
	}
	return item, session.AccountID, true
}

func (h *apiServer) GetFollowing(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	item, account, ok := h.followAccess(w, r, workItemId, false)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	following, err := sqlc.New(h.auth.pool).IsFollowingWorkItem(ctx, sqlc.IsFollowingWorkItemParams{WorkItemID: item.ID, AccountID: account})
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, gen.Following{Following: following})
}

func (h *apiServer) FollowWorkItem(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	item, account, ok := h.followAccess(w, r, workItemId, true)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := sqlc.New(h.auth.pool).FollowWorkItem(ctx, sqlc.FollowWorkItemParams{WorkItemID: item.ID, AccountID: account}); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiServer) UnfollowWorkItem(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	item, account, ok := h.followAccess(w, r, workItemId, true)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := sqlc.New(h.auth.pool).UnfollowWorkItem(ctx, sqlc.UnfollowWorkItemParams{WorkItemID: item.ID, AccountID: account}); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var hexColor = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func (h *apiServer) SetProjectAppearance(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	var payload gen.ProjectAppearanceRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	if !hexColor.MatchString(payload.Color) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	h.columnTx(w, r, projectId, func(ctx context.Context, q *sqlc.Queries) (int, any, error) {
		if err := q.UpdateProjectColor(ctx, sqlc.UpdateProjectColorParams{ID: pgUUID(projectId), Color: payload.Color}); err != nil {
			return 0, nil, err
		}
		return http.StatusNoContent, nil, nil
	})
}
