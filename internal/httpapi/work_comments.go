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

func (h *workAPI) ListWorkItemComments(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
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

func (h *workAPI) CreateWorkItemComment(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
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
func (h *workAPI) EncryptComment(w http.ResponseWriter, r *http.Request, commentId openapi_types.UUID) {
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
