package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/platform/objectstore"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

const (
	// MaxFileBytes is the original-file limit: exactly 500 MB, not MiB.
	MaxFileBytes        = 500_000_000
	uploadPartSize      = 8 << 20
	partURLTTL          = 15 * time.Minute
	downloadURLTTL      = 60 * time.Second
	defaultStorageQuota = 50_000_000_000
)

// fileContext is the resolved authorization for one attachment context.
type fileContext struct {
	organizationID pgtype.UUID
	projectID      pgtype.UUID
	workItemID     pgtype.UUID
	conversationID pgtype.UUID
	canUpload      bool
	canDownload    bool
	manager        bool
	archived       bool
}

// attachmentDomainFailure applies the content-encryption rule for the context
// that owns an attachment. The attachment ID is chosen by the client before an
// encrypted upload so its name envelope cannot be copied to another file.
func attachmentDomainFailure(ctx context.Context, q *sqlc.Queries, target fileContext, encrypted bool, account, attachmentID pgtype.UUID, signerID *pgtype.UUID, nameEnc *string) (*encFailure, error) {
	if target.workItemID.Valid {
		if encrypted {
			writer, failure, err := prepareEncrypted(ctx, q, account, target.projectID, "work", signerID)
			if err != nil || failure != nil {
				return failure, err
			}
			return writer.verify(account, attachmentResource(attachmentID), 1, *nameEnc), nil
		}
		return requirePlaintextAllowed(ctx, q, target.projectID, "work")
	}
	conversation, err := q.GetConversation(ctx, target.conversationID)
	if err != nil {
		return nil, err
	}
	writer, failure, err := channelDomainFailure(ctx, q, conversation, encrypted, account, signerID)
	if err != nil || failure != nil || !encrypted {
		return failure, err
	}
	return writer.verify(account, attachmentResource(attachmentID), 1, *nameEnc), nil
}

// resolveFileContext answers 404 for contexts the account cannot see. It never
// writes a response itself unless it returns ok=false.
func resolveFileContext(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, accountID pgtype.UUID, workItemID, conversationID pgtype.UUID) (fileContext, bool) {
	var result fileContext
	switch {
	case workItemID.Valid:
		item, err := q.GetWorkItem(ctx, workItemID)
		if errors.Is(err, pgx.ErrNoRows) {
			w.WriteHeader(http.StatusNotFound)
			return result, false
		}
		if err != nil {
			serverError(w, nil, err)
			return result, false
		}
		access, ok := loadAccess(ctx, w, q, item.ProjectID, accountID)
		if !ok {
			return result, false
		}
		read := access.access.Can(work.WorkRead)
		result.canDownload = read && access.access.Can(work.FilesDownload)
		result.canUpload = result.canDownload && access.access.Can(work.FilesUpload) && access.access.Can(work.WorkComment)
		result.manager, result.archived = access.access.Manager, access.archived
		result.projectID, result.workItemID = item.ProjectID, item.ID
		organizationID, err := q.GetProjectOrganization(ctx, item.ProjectID)
		if err != nil {
			serverError(w, nil, err)
			return result, false
		}
		result.organizationID = organizationID
	case conversationID.Valid:
		conversation, err := q.GetConversation(ctx, conversationID)
		if errors.Is(err, pgx.ErrNoRows) {
			w.WriteHeader(http.StatusNotFound)
			return result, false
		}
		if err != nil {
			serverError(w, nil, err)
			return result, false
		}
		_, chat, ok := resolveChatAccess(ctx, w, q, conversation, accountID)
		if !ok {
			return result, false
		}
		result.conversationID = conversation.ID
		result.archived, result.manager = chat.archived, chat.manager
		if conversation.Kind == "dm" {
			result.canDownload, result.canUpload = chat.read, chat.send
			membership, err := q.GetOrganizationMembershipForAccount(ctx, accountID)
			if err != nil {
				serverError(w, nil, err)
				return result, false
			}
			result.organizationID = membership.OrganizationID
			result.manager = false
			break
		}
		access, found := loadAccess(ctx, w, q, conversation.ProjectID, accountID)
		if !found {
			return result, false
		}
		result.canDownload = chat.read && access.access.Can(work.FilesDownload)
		result.canUpload = chat.send && result.canDownload && access.access.Can(work.FilesUpload)
		result.projectID = conversation.ProjectID
		organizationID, err := q.GetProjectOrganization(ctx, conversation.ProjectID)
		if err != nil {
			serverError(w, nil, err)
			return result, false
		}
		result.organizationID = organizationID
	default:
		w.WriteHeader(http.StatusBadRequest)
		return result, false
	}
	return result, true
}

func randomObjectKey() (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "o/" + hex.EncodeToString(raw), nil
}

var errStorageNotConfigured = errors.New("object storage is not configured")

func (h *filesAPI) storage(w http.ResponseWriter, r *http.Request) (objectstore.Store, bool) {
	if h.auth == nil || h.auth.store == nil {
		serverError(w, r, errStorageNotConfigured)
		return nil, false
	}
	return h.auth.store, true
}

// checkUploadRequest validates the shape and size of an upload request and
// returns the status to answer with, or 0 when the request is acceptable.
func checkUploadRequest(payload gen.CreateUploadRequest) int {
	if payload.Size < 1 {
		return http.StatusBadRequest
	}
	bodyEncrypted := payload.BodyEncrypted != nil && *payload.BodyEncrypted
	if payload.Size > MaxFileBytes+maxFileOverhead || (!bodyEncrypted && payload.Size > MaxFileBytes) {
		return http.StatusRequestEntityTooLarge
	}
	if bodyEncrypted {
		original, valid := plaintextSizeFor(payload.Size)
		if !valid {
			return http.StatusBadRequest
		}
		if original > MaxFileBytes {
			return http.StatusRequestEntityTooLarge
		}
		// The manifest is bound to the attachment id, so the client chooses it first.
		if payload.SignerDeviceId == nil || payload.Id == nil {
			return http.StatusBadRequest
		}
	}
	encryptedName := payload.NameEnc != nil
	if encryptedName == (payload.Name != nil) || (encryptedName && (payload.Id == nil || payload.SignerDeviceId == nil)) {
		return http.StatusBadRequest
	}
	return 0
}

func uploadPartCount(size int64) int32 {
	return int32((size + uploadPartSize - 1) / uploadPartSize)
}

func (h *filesAPI) CreateUpload(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	store, ok := h.storage(w, r)
	if !ok {
		return
	}
	var payload gen.CreateUploadRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	if status := checkUploadRequest(payload); status != 0 {
		w.WriteHeader(status)
		return
	}
	key, err := randomObjectKey()
	if err != nil {
		serverError(w, r, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	// Step 1: reserve quota and the single upload slot in the database.
	var attachment sqlc.Attachment
	err = h.inTx(ctx, func(q *sqlc.Queries) error {
		var reserveErr error
		attachment, reserveErr = h.reserveUpload(ctx, w, q, session.AccountID, payload, key)
		return reserveErr
	})
	if respondError(w, r, err) {
		return
	}
	// Step 2: external effect outside any database lock; reconcile on failure.
	if err = h.startMultipart(ctx, store, attachment); err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, gen.Upload{Id: fromPG(attachment.ID), PartSize: uploadPartSize, PartCount: int(uploadPartCount(payload.Size))})
}

// reserveUpload checks the caller's rights and the content rules, then books
// the quota and the person's single upload slot, inside the caller's
// transaction. Refusals it answers itself return errResponded.
func (h *filesAPI) reserveUpload(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, account pgtype.UUID, payload gen.CreateUploadRequest, key string) (sqlc.Attachment, error) {
	attachmentID := pgUUID(uuid.New())
	if payload.Id != nil {
		attachmentID = toPG(*payload.Id)
	}
	contentType := "application/octet-stream"
	if payload.ContentType != nil && *payload.ContentType != "" {
		contentType = *payload.ContentType
	}
	var workItemID, conversationID pgtype.UUID
	switch payload.ContextType {
	case gen.CreateUploadRequestContextTypeWorkItem:
		workItemID = toPG(payload.ContextId)
	case gen.CreateUploadRequestContextTypeConversation:
		conversationID = toPG(payload.ContextId)
	}
	target, ok := resolveFileContext(ctx, w, q, account, workItemID, conversationID)
	if !ok {
		return sqlc.Attachment{}, errResponded
	}
	if !target.canUpload {
		return sqlc.Attachment{}, statusError(http.StatusForbidden)
	}
	if target.archived {
		return sqlc.Attachment{}, statusError(http.StatusConflict)
	}
	var signerID *pgtype.UUID
	var contentSigner pgtype.UUID
	if payload.SignerDeviceId != nil {
		signerID = optionalUUIDValue(toPG(*payload.SignerDeviceId))
		contentSigner = *signerID
	}
	var nameEnvelope *string
	if payload.NameEnc != nil {
		value := string(*payload.NameEnc)
		nameEnvelope = &value
	}
	bodyEncrypted := payload.BodyEncrypted != nil && *payload.BodyEncrypted
	failure, bodySigner, err := uploadEncryptionFailure(ctx, q, target, account, attachmentID, signerID, nameEnvelope, payload, bodyEncrypted)
	if err != nil {
		return sqlc.Attachment{}, err
	}
	if failure != nil {
		failure.write(w)
		return sqlc.Attachment{}, errResponded
	}
	if err = q.LockOrganization(ctx, target.organizationID); err != nil {
		return sqlc.Attachment{}, err
	}
	reserved, err := q.ReservedStorage(ctx, target.organizationID)
	if err != nil {
		return sqlc.Attachment{}, err
	}
	if reserved+payload.Size > h.auth.quota {
		return sqlc.Attachment{}, statusError(http.StatusInsufficientStorage)
	}
	name := ""
	if payload.Name != nil {
		name = *payload.Name
	}
	var nameEnc []byte
	if nameEnvelope != nil {
		nameEnc, _ = unb64(*nameEnvelope, 0)
	}
	attachment, err := q.CreateAttachment(ctx, sqlc.CreateAttachmentParams{
		ID: attachmentID, OrganizationID: target.organizationID, ProjectID: target.projectID, WorkItemID: target.workItemID,
		ConversationID: target.conversationID, UploaderID: account, ObjectKey: key,
		Name: name, Encrypted: nameEnvelope != nil, NameEnc: nameEnc, ContentAuthorID: account,
		ContentSignerDeviceID: contentSigner,
		ContentType:           contentType, DeclaredSize: payload.Size, PartSize: uploadPartSize, PartCount: uploadPartCount(payload.Size),
		BodyEncrypted: bodyEncrypted, BodySignerDeviceID: bodySigner,
	})
	if isUniqueViolation(err) {
		// The partial unique index allows one active upload per person.
		return attachment, statusError(http.StatusConflict)
	}
	return attachment, err
}

// uploadEncryptionFailure applies the encryption rules to the file name and to
// the body, and returns the body signer to store with the attachment.
func uploadEncryptionFailure(ctx context.Context, q *sqlc.Queries, target fileContext, account, attachmentID pgtype.UUID, signerID *pgtype.UUID, nameEnvelope *string, payload gen.CreateUploadRequest, bodyEncrypted bool) (*encFailure, pgtype.UUID, error) {
	var bodySigner pgtype.UUID
	failure, err := attachmentDomainFailure(ctx, q, target, nameEnvelope != nil, account, attachmentID, signerID, nameEnvelope)
	if err != nil || failure != nil {
		return failure, bodySigner, err
	}
	domain, found, err := bodyDomain(ctx, q, target)
	if err != nil {
		return nil, bodySigner, err
	}
	if failure = bodyEncryptionFailure(domain, found, bodyEncrypted); failure == nil && bodyEncrypted {
		bodySigner = toPG(*payload.SignerDeviceId)
		_, failure, err = prepareEncryptedWith(ctx, q, account, domain, found, &bodySigner)
	}
	return failure, bodySigner, err
}

// startMultipart opens the bucket upload for a reserved attachment. When the
// bucket refuses, the reservation is released so the person can retry.
func (h *filesAPI) startMultipart(ctx context.Context, store objectstore.Store, attachment sqlc.Attachment) error {
	uploadID, err := store.CreateMultipart(ctx, attachment.ObjectKey)
	pool := sqlc.New(h.auth.pool)
	if err == nil {
		err = pool.SetAttachmentUploadID(ctx, sqlc.SetAttachmentUploadIDParams{ID: attachment.ID, UploadID: uploadID})
	}
	if err != nil {
		_ = pool.MarkAttachmentReleased(ctx, sqlc.MarkAttachmentReleasedParams{ID: attachment.ID, State: "aborted"})
		_ = pool.MarkAttachmentObjectRemoved(ctx, attachment.ID)
	}
	return err
}

// ownUpload returns the caller's active upload or answers 404/409.
func (h *filesAPI) ownUpload(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, id openapi_types.UUID, account pgtype.UUID, requireActive bool) (sqlc.Attachment, bool) {
	attachment, err := q.GetAttachment(ctx, toPG(id))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && attachment.UploaderID != account) {
		w.WriteHeader(http.StatusNotFound)
		return attachment, false
	}
	if err != nil {
		serverError(w, nil, err)
		return attachment, false
	}
	if requireActive && (attachment.State != "uploading" || attachment.UploadID == "pending") {
		w.WriteHeader(http.StatusConflict)
		return attachment, false
	}
	return attachment, true
}

func (h *filesAPI) PresignUploadPart(w http.ResponseWriter, r *http.Request, uploadId gen.UploadId, partNumber int) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	store, ok := h.storage(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	attachment, ok := h.ownUpload(ctx, w, sqlc.New(h.auth.pool), uploadId, session.AccountID, true)
	if !ok {
		return
	}
	if partNumber < 1 || partNumber > int(attachment.PartCount) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	url, err := store.PresignPart(ctx, attachment.ObjectKey, attachment.UploadID, int32(partNumber), partURLTTL)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, gen.PresignedUrl{Url: url, ExpiresInSeconds: int(partURLTTL.Seconds())})
}

func toAttachment(row sqlc.Attachment, uploaderEmail string) gen.Attachment {
	attachment := gen.Attachment{
		Id: fromPG(row.ID), Name: row.Name, ContentType: row.ContentType, Size: row.StoredSize.Int64,
		UploaderEmail: uploaderEmail, CreatedAt: row.CreatedAt.Time, Encrypted: row.Encrypted,
		BodyEncrypted: &row.BodyEncrypted,
	}
	contentSize := row.StoredSize.Int64
	if row.BodyEncrypted {
		contentSize, _ = plaintextSizeFor(contentSize)
	}
	attachment.ContentSize = &contentSize
	if row.UploaderID.Valid {
		uploader := fromPG(row.UploaderID)
		attachment.UploaderId = &uploader
	}
	if row.BodyEncrypted && row.BodySignerDeviceID.Valid {
		signer := fromPG(row.BodySignerDeviceID)
		attachment.BodySignerDeviceId = &signer
	}
	if row.Encrypted {
		attachment.NameEnc = blob(row.NameEnc)
		if row.ContentAuthorID.Valid {
			author := fromPG(row.ContentAuthorID)
			attachment.ContentAuthorId = &author
		}
		if row.ContentSignerDeviceID.Valid {
			signer := fromPG(row.ContentSignerDeviceID)
			attachment.SignerDeviceId = &signer
		}
	}
	return attachment
}

func (h *filesAPI) CompleteUpload(w http.ResponseWriter, r *http.Request, uploadId gen.UploadId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	store, ok := h.storage(w, r)
	if !ok {
		return
	}
	var payload gen.CompleteUploadRequest
	if !decodeJSONBodyLimit(w, r, &payload, 1<<20) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	attachment, ok := h.ownUpload(ctx, w, q, uploadId, session.AccountID, false)
	if !ok {
		return
	}
	if attachment.State == "ready" {
		writeJSON(w, http.StatusOK, toAttachment(attachment, session.EmailNormalized))
		return
	}
	if attachment.State != "uploading" || attachment.UploadID == "pending" {
		w.WriteHeader(http.StatusConflict)
		return
	}
	parts, valid := completionParts(payload, attachment)
	if !valid {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	// The bucket call happens with no database lock held.
	if err := store.Complete(ctx, attachment.ObjectKey, attachment.UploadID, parts); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	size, err := store.Size(ctx, attachment.ObjectKey)
	if err != nil {
		serverError(w, r, err)
		return
	}
	// Stored bytes equal the reservation: the file for a plaintext body, the
	// computed ciphertext size for an encrypted one.
	if size != attachment.DeclaredSize {
		discardUpload(ctx, w, q, store, attachment, "deleted", http.StatusBadRequest, nil)
		return
	}
	if attachment.BodyEncrypted {
		failure, verifyErr := verifyStoredManifest(ctx, q, store, attachment)
		if verifyErr != nil {
			serverError(w, r, verifyErr)
			return
		}
		if failure != nil {
			discardUpload(ctx, w, q, store, attachment, "aborted", http.StatusBadRequest, failure)
			return
		}
	}
	changed, err := q.MarkAttachmentReady(ctx, sqlc.MarkAttachmentReadyParams{ID: attachment.ID, StoredSize: pgtype.Int8{Int64: size, Valid: true}})
	if err != nil {
		serverError(w, r, err)
		return
	}
	if changed == 0 {
		w.WriteHeader(http.StatusConflict)
		return
	}
	attachment.StoredSize = pgtype.Int8{Int64: size, Valid: true}
	writeJSON(w, http.StatusOK, toAttachment(attachment, session.EmailNormalized))
}

// completionParts checks that the client lists every part, in order, and
// converts them for the bucket.
func completionParts(payload gen.CompleteUploadRequest, attachment sqlc.Attachment) ([]objectstore.Part, bool) {
	if len(payload.Parts) != int(attachment.PartCount) {
		return nil, false
	}
	parts := make([]objectstore.Part, len(payload.Parts))
	for index, part := range payload.Parts {
		if part.PartNumber != index+1 {
			return nil, false
		}
		parts[index] = objectstore.Part{Number: int32(part.PartNumber), ETag: part.Etag}
	}
	return parts, true
}

// discardUpload releases a finished object that failed its checks, frees the
// reservation and answers with the failure (or the plain status).
func discardUpload(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, store objectstore.Store, attachment sqlc.Attachment, state string, status int, failure *encFailure) {
	_ = q.MarkAttachmentReleased(ctx, sqlc.MarkAttachmentReleasedParams{ID: attachment.ID, State: state})
	if store.Delete(ctx, attachment.ObjectKey) == nil {
		_ = q.MarkAttachmentObjectRemoved(ctx, attachment.ID)
	}
	if failure != nil {
		failure.write(w)
		return
	}
	w.WriteHeader(status)
}

func (h *filesAPI) AbortUpload(w http.ResponseWriter, r *http.Request, uploadId gen.UploadId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	attachment, ok := h.ownUpload(ctx, w, q, uploadId, session.AccountID, false)
	if !ok {
		return
	}
	if attachment.State == "uploading" {
		if err := q.MarkAttachmentReleased(ctx, sqlc.MarkAttachmentReleasedParams{ID: attachment.ID, State: "aborted"}); err != nil {
			serverError(w, r, err)
			return
		}
		attachment.State = "aborted"
		h.releaseObject(ctx, q, attachment)
	}
	w.WriteHeader(http.StatusNoContent)
}

// releaseObject best-effort frees the bucket resources of an aborted or deleted
// attachment; the scheduled cleanup retries anything left behind.
func (h *filesAPI) releaseObject(ctx context.Context, q *sqlc.Queries, attachment sqlc.Attachment) {
	if h.auth.store == nil {
		return
	}
	if objectstore.Release(ctx, h.auth.store, attachment.State, attachment.ObjectKey, attachment.UploadID) == nil {
		_ = q.MarkAttachmentObjectRemoved(ctx, attachment.ID)
	}
}

func (h *filesAPI) GetAttachmentDownload(w http.ResponseWriter, r *http.Request, attachmentId openapi_types.UUID) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	store, ok := h.storage(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	attachment, err := q.GetAttachment(ctx, toPG(attachmentId))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && attachment.State != "ready") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	target, ok := resolveFileContext(ctx, w, q, session.AccountID, attachment.WorkItemID, attachment.ConversationID)
	if !ok {
		return
	}
	if !target.canDownload {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	url, err := store.PresignGet(ctx, attachment.ObjectKey, downloadURLTTL)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, gen.PresignedUrl{Url: url, ExpiresInSeconds: int(downloadURLTTL.Seconds())})
}

func (h *filesAPI) DeleteAttachment(w http.ResponseWriter, r *http.Request, attachmentId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	attachment, err := q.GetAttachment(ctx, toPG(attachmentId))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && attachment.State != "ready") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	target, ok := resolveFileContext(ctx, w, q, session.AccountID, attachment.WorkItemID, attachment.ConversationID)
	if !ok {
		return
	}
	if attachment.UploaderID != session.AccountID && !target.manager {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if err = q.MarkAttachmentReleased(ctx, sqlc.MarkAttachmentReleasedParams{ID: attachment.ID, State: "deleted"}); err != nil {
		serverError(w, r, err)
		return
	}
	// The object stays 30 days (see ReleaseStorage) so a database restore still finds it.
	w.WriteHeader(http.StatusNoContent)
}

func (h *filesAPI) listAttachments(w http.ResponseWriter, r *http.Request, workItemID, conversationID pgtype.UUID) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	target, ok := resolveFileContext(ctx, w, q, session.AccountID, workItemID, conversationID)
	if !ok {
		return
	}
	if !target.canDownload {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	attachments := []gen.Attachment{}
	if workItemID.Valid {
		rows, err := q.ListWorkItemAttachments(ctx, workItemID)
		if err != nil {
			serverError(w, r, err)
			return
		}
		for _, row := range rows {
			attachments = append(attachments, toAttachment(sqlc.Attachment{
				ID: row.ID, Name: row.Name, ContentType: row.ContentType, StoredSize: row.StoredSize, CreatedAt: row.CreatedAt,
				Encrypted: row.Encrypted, NameEnc: row.NameEnc, ContentAuthorID: row.ContentAuthorID, ContentSignerDeviceID: row.ContentSignerDeviceID,
				BodyEncrypted: row.BodyEncrypted, UploaderID: row.UploaderID, BodySignerDeviceID: row.BodySignerDeviceID,
			}, row.UploaderEmail))
		}
	} else {
		rows, err := q.ListConversationAttachments(ctx, conversationID)
		if err != nil {
			serverError(w, r, err)
			return
		}
		for _, row := range rows {
			attachments = append(attachments, toAttachment(sqlc.Attachment{
				ID: row.ID, Name: row.Name, ContentType: row.ContentType, StoredSize: row.StoredSize, CreatedAt: row.CreatedAt,
				Encrypted: row.Encrypted, NameEnc: row.NameEnc, ContentAuthorID: row.ContentAuthorID, ContentSignerDeviceID: row.ContentSignerDeviceID,
				BodyEncrypted: row.BodyEncrypted, UploaderID: row.UploaderID, BodySignerDeviceID: row.BodySignerDeviceID,
			}, row.UploaderEmail))
		}
	}
	writeJSON(w, http.StatusOK, attachments)
}

func (h *filesAPI) ListWorkItemAttachments(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	h.listAttachments(w, r, toPG(workItemId), pgtype.UUID{})
}

func (h *filesAPI) ListConversationAttachments(w http.ResponseWriter, r *http.Request, conversationId openapi_types.UUID) {
	h.listAttachments(w, r, pgtype.UUID{}, toPG(conversationId))
}

func (h *filesAPI) GetStorageUsage(w http.ResponseWriter, r *http.Request) {
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
	membership, err := q.GetOrganizationMembershipForAccount(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	reserved, err := q.ReservedStorage(ctx, membership.OrganizationID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, gen.StorageUsage{QuotaBytes: h.auth.quota, ReservedBytes: reserved})
}
