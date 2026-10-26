package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func toEpic(epic sqlc.Epic) gen.Epic {
	response := gen.Epic{
		Id: fromPG(epic.ID), ProjectId: fromPG(epic.ProjectID), Title: epic.Title,
		Description: epic.Description, Done: epic.Done, Version: int(epic.Version),
		Encrypted: epic.Encrypted, ContentRevision: int(epic.ContentRevision),
	}
	if epic.Encrypted {
		response.TitleEnc, response.DescriptionEnc = blob(epic.TitleEnc), blob(epic.DescriptionEnc)
		if epic.ContentAuthorID.Valid {
			author := fromPG(epic.ContentAuthorID)
			response.ContentAuthorId = &author
		}
		if epic.ContentSignerDeviceID.Valid {
			signer := fromPG(epic.ContentSignerDeviceID)
			response.SignerDeviceId = &signer
		}
	}
	return response
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
	if !decodeJSONBodyLimit(w, r, &payload, contentBodyLimit) {
		return
	}
	encrypted := payload.TitleEnc != nil || payload.DescriptionEnc != nil
	if encrypted && (payload.TitleEnc == nil || payload.DescriptionEnc == nil || payload.Id == nil || payload.SignerDeviceId == nil || payload.Title != nil || payload.Description != nil) ||
		!encrypted && payload.Title == nil {
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
	if !access.access.Can(work.WorkRead) || !access.access.Can(work.PlanningEdit) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if access.archived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	var (
		epic sqlc.Epic
		err  error
	)
	if encrypted {
		id := pgUUID(uuidFrom(*payload.Id))
		writer, fail, prepErr := prepareEncrypted(ctx, q, session.AccountID, pgUUID(projectId), "work", optionalUUIDValue(pgUUID(uuidFrom(*payload.SignerDeviceId))))
		if prepErr == nil && fail == nil {
			if fail = writer.verify(session.AccountID, epicResource(id, "title"), 1, *payload.TitleEnc); fail == nil {
				fail = writer.verify(session.AccountID, epicResource(id, "desc"), 1, *payload.DescriptionEnc)
			}
		}
		if prepErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if fail != nil {
			fail.write(w)
			return
		}
		titleEnc, _ := unb64(*payload.TitleEnc, 0)
		descriptionEnc, _ := unb64(*payload.DescriptionEnc, 0)
		epic, err = q.CreateEncryptedEpic(ctx, sqlc.CreateEncryptedEpicParams{
			ID: id, ProjectID: pgUUID(projectId), CreatedBy: session.AccountID, TitleEnc: titleEnc, DescriptionEnc: descriptionEnc, ContentSignerDeviceID: writer.signer.ID,
		})
	} else {
		fail, planErr := requirePlaintextAllowed(ctx, q, pgUUID(projectId), "work")
		if planErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if fail != nil {
			fail.write(w)
			return
		}
		description := ""
		if payload.Description != nil {
			description = *payload.Description
		}
		epic, err = q.CreateEpic(ctx, sqlc.CreateEpicParams{ProjectID: pgUUID(projectId), Title: *payload.Title, Description: description, CreatedBy: session.AccountID})
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
	writeJSON(w, http.StatusCreated, toEpic(epic))
}

func (h *healthHandler) UpdateEpic(w http.ResponseWriter, r *http.Request, epicId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.UpdateEpicRequest
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
	var writer *encContext
	if encContent {
		var fail *encFailure
		revision := int32(*payload.ContentRevision)
		writer, fail, err = prepareEncrypted(ctx, q, session.AccountID, epic.ProjectID, "work", optionalUUIDValue(pgUUID(uuidFrom(*payload.SignerDeviceId))))
		if err == nil && fail == nil && revision != epic.ContentRevision+1 {
			fail = &encFailure{http.StatusConflict, gen.ApiErrorCodeBadRevision}
		}
		if err == nil && fail == nil {
			if fail = writer.verify(session.AccountID, epicResource(epic.ID, "title"), revision, *payload.TitleEnc); fail == nil {
				fail = writer.verify(session.AccountID, epicResource(epic.ID, "desc"), revision, *payload.DescriptionEnc)
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
		fail, planErr := requirePlaintextAllowed(ctx, q, epic.ProjectID, "work")
		if planErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if fail != nil {
			fail.write(w)
			return
		}
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
	if err == nil && encContent {
		titleEnc, _ := unb64(*payload.TitleEnc, 0)
		descriptionEnc, _ := unb64(*payload.DescriptionEnc, 0)
		var changed int64
		changed, err = q.SetEpicContent(ctx, sqlc.SetEpicContentParams{
			ID: epic.ID, TitleEnc: titleEnc, DescriptionEnc: descriptionEnc, ContentRevision: int32(*payload.ContentRevision),
			ContentAuthorID: session.AccountID, ContentSignerDeviceID: writer.signer.ID,
		})
		if err == nil && changed == 0 {
			w.WriteHeader(http.StatusConflict)
			return
		}
		if err == nil {
			updated, err = q.GetEpic(ctx, epic.ID)
		}
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
