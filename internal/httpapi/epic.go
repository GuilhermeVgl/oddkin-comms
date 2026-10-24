package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/oddkin-comms/internal/work"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func toEpic(epic sqlc.Epic) gen.Epic {
	return gen.Epic{
		Id: fromPG(epic.ID), ProjectId: fromPG(epic.ProjectID), Title: epic.Title,
		Description: epic.Description, Done: epic.Done, Version: int(epic.Version),
	}
}

func (h *healthHandler) ListEpics(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
	rows, err := q.ListEpics(ctx, pgUUID(projectId))
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	epics := make([]gen.Epic, 0, len(rows))
	for _, row := range rows {
		epics = append(epics, toEpic(row))
	}
	writeJSON(w, http.StatusOK, epics)
}

func (h *healthHandler) CreateEpic(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.CreateEpicRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	access, ok := loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID)
	if !ok {
		return
	}
	if !access.access.Can(work.WorkRead) || !access.access.Can(work.PlanningEdit) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if access.archived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	description := ""
	if payload.Description != nil {
		description = *payload.Description
	}
	epic, err := q.CreateEpic(ctx, sqlc.CreateEpicParams{ProjectID: pgUUID(projectId), Title: payload.Title, Description: description, CreatedBy: session.AccountID})
	if isConstraintViolation(err) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusCreated, toEpic(epic))
}

func (h *healthHandler) UpdateEpic(w http.ResponseWriter, r *http.Request, epicId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.UpdateEpicRequest
	if !decodeJSONBody(w, r, &payload) {
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
	epic, err := q.GetEpicForUpdate(ctx, pgUUID(uuidFrom(epicId)))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	access, ok := loadAccess(ctx, w, q, epic.ProjectID, session.AccountID)
	if !ok {
		return
	}
	if !access.access.Can(work.WorkRead) || !access.access.Can(work.PlanningEdit) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if access.archived || int32(payload.Version) != epic.Version {
		w.WriteHeader(http.StatusConflict)
		return
	}
	params := sqlc.UpdateEpicParams{ID: epic.ID, Version: epic.Version}
	if payload.Title != nil {
		params.Title = pgtype.Text{String: *payload.Title, Valid: true}
	}
	if payload.Description != nil {
		params.Description = pgtype.Text{String: *payload.Description, Valid: true}
	}
	if payload.Done != nil {
		if *payload.Done && !epic.Done {
			open, countErr := q.CountOpenEpicTasks(ctx, epic.ID)
			if countErr != nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			if open > 0 {
				w.WriteHeader(http.StatusConflict)
				return
			}
		}
		params.Done = pgtype.Bool{Bool: *payload.Done, Valid: true}
	}
	updated, err := q.UpdateEpic(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
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
	if err = tx.Commit(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, toEpic(updated))
}
