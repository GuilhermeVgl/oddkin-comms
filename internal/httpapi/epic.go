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

func (h *apiServer) ListEpics(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
		serverError(w, r, err)
		return
	}
	epics := make([]gen.Epic, 0, len(rows))
	for _, row := range rows {
		epics = append(epics, toEpic(row))
	}
	writeJSON(w, http.StatusOK, epics)
}

func (h *apiServer) CreateEpic(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
		epic, err = insertEncryptedEpic(ctx, w, q, session.AccountID, pgUUID(projectId), payload)
	} else {
		epic, err = insertPlainEpic(ctx, w, q, session.AccountID, pgUUID(projectId), payload)
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
		writeJSON(w, http.StatusCreated, toEpic(epic))
	}
}

// insertEncryptedEpic stores an epic whose title and description arrive as
// envelopes signed by the author's device. A refusal is written to w and
// reported as errResponded.
func insertEncryptedEpic(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, account, projectID pgtype.UUID, payload gen.CreateEpicRequest) (sqlc.Epic, error) {
	id := toPG(*payload.Id)
	writer, fail, err := prepareEncrypted(ctx, q, account, projectID, "work", optionalUUIDValue(toPG(*payload.SignerDeviceId)))
	if err != nil {
		return sqlc.Epic{}, err
	}
	if fail == nil {
		if fail = writer.verify(account, epicResource(id, "title"), 1, *payload.TitleEnc); fail == nil {
			fail = writer.verify(account, epicResource(id, "desc"), 1, *payload.DescriptionEnc)
		}
	}
	if fail != nil {
		fail.write(w)
		return sqlc.Epic{}, errResponded
	}
	titleEnc, _ := unb64(*payload.TitleEnc, 0)
	descriptionEnc, _ := unb64(*payload.DescriptionEnc, 0)
	return q.CreateEncryptedEpic(ctx, sqlc.CreateEncryptedEpicParams{
		ID: id, ProjectID: projectID, CreatedBy: account, TitleEnc: titleEnc, DescriptionEnc: descriptionEnc, ContentSignerDeviceID: writer.signer.ID,
	})
}

// insertPlainEpic stores an epic in the clear, which only a project that has
// not started encrypting its work may still do.
func insertPlainEpic(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, account, projectID pgtype.UUID, payload gen.CreateEpicRequest) (sqlc.Epic, error) {
	fail, err := requirePlaintextAllowed(ctx, q, projectID, "work")
	if err != nil {
		return sqlc.Epic{}, err
	}
	if fail != nil {
		fail.write(w)
		return sqlc.Epic{}, errResponded
	}
	description := ""
	if payload.Description != nil {
		description = *payload.Description
	}
	return q.CreateEpic(ctx, sqlc.CreateEpicParams{ProjectID: projectID, Title: *payload.Title, Description: description, CreatedBy: account})
}

func (h *apiServer) UpdateEpic(w http.ResponseWriter, r *http.Request, epicId openapi_types.UUID) {
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
	var updated sqlc.Epic
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		epic, err := q.GetEpicForUpdate(ctx, toPG(epicId))
		if errors.Is(err, pgx.ErrNoRows) {
			return statusError(http.StatusNotFound)
		}
		if err != nil {
			return err
		}
		access, ok := loadAccess(ctx, w, q, epic.ProjectID, session.AccountID)
		if !ok {
			return errResponded
		}
		if !access.access.Can(work.WorkRead) || !access.access.Can(work.PlanningEdit) {
			return statusError(http.StatusForbidden)
		}
		if access.archived || int32(payload.Version) != epic.Version {
			return statusError(http.StatusConflict)
		}
		writer, err := checkEpicContentWrite(ctx, w, q, session.AccountID, epic, payload)
		if err != nil {
			return err
		}
		params, err := epicUpdateParams(ctx, q, epic, payload)
		if err != nil {
			return err
		}
		updated, err = q.UpdateEpic(ctx, params)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return statusError(http.StatusConflict)
		case isConstraintViolation(err):
			return statusError(http.StatusBadRequest)
		case err != nil:
			return err
		}
		if encContent {
			updated, err = storeEpicContent(ctx, q, session.AccountID, epic.ID, writer, payload)
		}
		return err
	})
	if respondError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, toEpic(updated))
}

// checkEpicContentWrite validates the content part of an epic update: an
// encrypted write must be signed, carry the next revision and use a usable
// domain; a plain-text edit is refused once the project encrypts its work. It
// returns the validated writer for an encrypted write and nil otherwise. A
// refusal is written to w and reported as errResponded.
func checkEpicContentWrite(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, account pgtype.UUID, epic sqlc.Epic, payload gen.UpdateEpicRequest) (*encContext, error) {
	if payload.TitleEnc != nil || payload.DescriptionEnc != nil {
		revision := int32(*payload.ContentRevision)
		writer, fail, err := prepareEncrypted(ctx, q, account, epic.ProjectID, "work", optionalUUIDValue(toPG(*payload.SignerDeviceId)))
		if err != nil {
			return nil, err
		}
		if fail == nil && revision != epic.ContentRevision+1 {
			fail = &encFailure{http.StatusConflict, gen.ApiErrorCodeBadRevision}
		}
		if fail == nil {
			if fail = writer.verify(account, epicResource(epic.ID, "title"), revision, *payload.TitleEnc); fail == nil {
				fail = writer.verify(account, epicResource(epic.ID, "desc"), revision, *payload.DescriptionEnc)
			}
		}
		if fail != nil {
			fail.write(w)
			return nil, errResponded
		}
		return writer, nil
	}
	if payload.Title != nil || payload.Description != nil {
		fail, err := requirePlaintextAllowed(ctx, q, epic.ProjectID, "work")
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

// epicUpdateParams builds the optimistic update. An epic cannot be marked done
// while it still has open tasks.
func epicUpdateParams(ctx context.Context, q *sqlc.Queries, epic sqlc.Epic, payload gen.UpdateEpicRequest) (sqlc.UpdateEpicParams, error) {
	params := sqlc.UpdateEpicParams{ID: epic.ID, Version: epic.Version}
	if payload.Title != nil {
		params.Title = pgtype.Text{String: *payload.Title, Valid: true}
	}
	if payload.Description != nil {
		params.Description = pgtype.Text{String: *payload.Description, Valid: true}
	}
	if payload.Done != nil {
		if *payload.Done && !epic.Done {
			open, err := q.CountOpenEpicTasks(ctx, epic.ID)
			if err != nil {
				return params, err
			}
			if open > 0 {
				return params, statusError(http.StatusConflict)
			}
		}
		params.Done = pgtype.Bool{Bool: *payload.Done, Valid: true}
	}
	return params, nil
}

// storeEpicContent saves the new envelopes and returns the epic as stored.
func storeEpicContent(ctx context.Context, q *sqlc.Queries, account, epicID pgtype.UUID, writer *encContext, payload gen.UpdateEpicRequest) (sqlc.Epic, error) {
	titleEnc, _ := unb64(*payload.TitleEnc, 0)
	descriptionEnc, _ := unb64(*payload.DescriptionEnc, 0)
	changed, err := q.SetEpicContent(ctx, sqlc.SetEpicContentParams{
		ID: epicID, TitleEnc: titleEnc, DescriptionEnc: descriptionEnc, ContentRevision: int32(*payload.ContentRevision),
		ContentAuthorID: account, ContentSignerDeviceID: writer.signer.ID,
	})
	if err != nil {
		return sqlc.Epic{}, err
	}
	if changed == 0 {
		return sqlc.Epic{}, statusError(http.StatusConflict)
	}
	return q.GetEpic(ctx, epicID)
}
