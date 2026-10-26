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
			w.WriteHeader(http.StatusServiceUnavailable)
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
			w.WriteHeader(http.StatusServiceUnavailable)
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
			w.WriteHeader(http.StatusServiceUnavailable)
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
				w.WriteHeader(http.StatusServiceUnavailable)
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
			w.WriteHeader(http.StatusServiceUnavailable)
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

func (h *healthHandler) storage(w http.ResponseWriter) (objectstore.Store, bool) {
	if h.auth == nil || h.auth.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return nil, false
	}
	return h.auth.store, true
}

func (h *healthHandler) CreateUpload(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	store, ok := h.storage(w)
	if !ok {
		return
	}
	var payload gen.CreateUploadRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	if payload.Size < 1 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	bodyEncrypted := payload.BodyEncrypted != nil && *payload.BodyEncrypted
	if payload.Size > MaxFileBytes+maxFileOverhead || (!bodyEncrypted && payload.Size > MaxFileBytes) {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	if bodyEncrypted {
		original, valid := plaintextSizeFor(payload.Size)
		if !valid {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if original > MaxFileBytes {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		// The manifest is bound to the attachment id, so the client chooses it first.
		if payload.SignerDeviceId == nil || payload.Id == nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
	}
	encryptedName := payload.NameEnc != nil
	if encryptedName == (payload.Name != nil) || (encryptedName && (payload.Id == nil || payload.SignerDeviceId == nil)) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	attachmentID := pgUUID(uuid.New())
	if payload.Id != nil {
		attachmentID = pgUUID(uuidFrom(*payload.Id))
	}
	contentType := "application/octet-stream"
	if payload.ContentType != nil && *payload.ContentType != "" {
		contentType = *payload.ContentType
	}
	var workItemID, conversationID pgtype.UUID
	switch payload.ContextType {
	case gen.CreateUploadRequestContextTypeWorkItem:
		workItemID = pgUUID(uuidFrom(payload.ContextId))
	case gen.CreateUploadRequestContextTypeConversation:
		conversationID = pgUUID(uuidFrom(payload.ContextId))
	}
	key, err := randomObjectKey()
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	partCount := int32((payload.Size + uploadPartSize - 1) / uploadPartSize)

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	// Step 1: reserve quota and the single upload slot in the database.
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	target, ok := resolveFileContext(ctx, w, q, session.AccountID, workItemID, conversationID)
	if !ok {
		return
	}
	if !target.canUpload {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if target.archived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	var signerID *pgtype.UUID
	if payload.SignerDeviceId != nil {
		signerID = optionalUUIDValue(pgUUID(uuidFrom(*payload.SignerDeviceId)))
	}
	var nameEnvelope *string
	if payload.NameEnc != nil {
		value := string(*payload.NameEnc)
		nameEnvelope = &value
	}
	failure, err := attachmentDomainFailure(ctx, q, target, encryptedName, session.AccountID, attachmentID, signerID, nameEnvelope)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if failure != nil {
		failure.write(w)
		return
	}
	var bodySigner pgtype.UUID
	domain, found, err := bodyDomain(ctx, q, target)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if failure = bodyEncryptionFailure(domain, found, bodyEncrypted); failure == nil && bodyEncrypted {
		bodySigner = pgUUID(uuidFrom(*payload.SignerDeviceId))
		_, failure, err = prepareEncryptedWith(ctx, q, session.AccountID, domain, found, &bodySigner)
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
	}
	if failure != nil {
		failure.write(w)
		return
	}
	if err = q.LockOrganization(ctx, target.organizationID); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	reserved, err := q.ReservedStorage(ctx, target.organizationID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if reserved+payload.Size > h.auth.quota {
		w.WriteHeader(http.StatusInsufficientStorage)
		return
	}
	name := ""
	if payload.Name != nil {
		name = *payload.Name
	}
	var nameEnc []byte
	if encryptedName {
		nameEnc, _ = unb64(*nameEnvelope, 0)
	}
	attachment, err := q.CreateAttachment(ctx, sqlc.CreateAttachmentParams{
		ID: attachmentID, OrganizationID: target.organizationID, ProjectID: target.projectID, WorkItemID: target.workItemID,
		ConversationID: target.conversationID, UploaderID: session.AccountID, ObjectKey: key,
		Name: name, Encrypted: encryptedName, NameEnc: nameEnc, ContentAuthorID: session.AccountID,
		ContentSignerDeviceID: func() pgtype.UUID {
			if signerID != nil {
				return *signerID
			}
			return pgtype.UUID{}
		}(),
		ContentType: contentType, DeclaredSize: payload.Size, PartSize: uploadPartSize, PartCount: partCount,
		BodyEncrypted: bodyEncrypted, BodySignerDeviceID: bodySigner,
	})
	if isUniqueViolation(err) {
		// The partial unique index allows one active upload per person.
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	// Step 2: external effect outside any database lock; reconcile on failure.
	uploadID, err := store.CreateMultipart(ctx, key)
	pool := sqlc.New(h.auth.pool)
	if err == nil {
		err = pool.SetAttachmentUploadID(ctx, sqlc.SetAttachmentUploadIDParams{ID: attachment.ID, UploadID: uploadID})
	}
	if err != nil {
		_ = pool.MarkAttachmentReleased(ctx, sqlc.MarkAttachmentReleasedParams{ID: attachment.ID, State: "aborted"})
		_ = pool.MarkAttachmentObjectRemoved(ctx, attachment.ID)
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusCreated, gen.Upload{Id: fromPG(attachment.ID), PartSize: uploadPartSize, PartCount: int(partCount)})
}

// ownUpload returns the caller's active upload or answers 404/409.
func (h *healthHandler) ownUpload(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, id openapi_types.UUID, account pgtype.UUID, requireActive bool) (sqlc.Attachment, bool) {
	attachment, err := q.GetAttachment(ctx, pgUUID(uuidFrom(id)))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && attachment.UploaderID != account) {
		w.WriteHeader(http.StatusNotFound)
		return attachment, false
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return attachment, false
	}
	if requireActive && (attachment.State != "uploading" || attachment.UploadID == "pending") {
		w.WriteHeader(http.StatusConflict)
		return attachment, false
	}
	return attachment, true
}

func (h *healthHandler) PresignUploadPart(w http.ResponseWriter, r *http.Request, uploadId gen.UploadId, partNumber int) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	store, ok := h.storage(w)
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
		w.WriteHeader(http.StatusServiceUnavailable)
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

func (h *healthHandler) CompleteUpload(w http.ResponseWriter, r *http.Request, uploadId gen.UploadId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	store, ok := h.storage(w)
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
	if len(payload.Parts) != int(attachment.PartCount) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	parts := make([]objectstore.Part, len(payload.Parts))
	for index, part := range payload.Parts {
		if part.PartNumber != index+1 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		parts[index] = objectstore.Part{Number: int32(part.PartNumber), ETag: part.Etag}
	}
	// The bucket call happens with no database lock held.
	if err := store.Complete(ctx, attachment.ObjectKey, attachment.UploadID, parts); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	size, err := store.Size(ctx, attachment.ObjectKey)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	// Stored bytes equal the reservation: the file for a plaintext body, the
	// computed ciphertext size for an encrypted one.
	discard := func(state string, status int, failure *encFailure) {
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
	if size != attachment.DeclaredSize {
		discard("deleted", http.StatusBadRequest, nil)
		return
	}
	if attachment.BodyEncrypted {
		failure, verifyErr := verifyStoredManifest(ctx, q, store, attachment)
		if verifyErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if failure != nil {
			discard("aborted", http.StatusBadRequest, failure)
			return
		}
	}
	changed, err := q.MarkAttachmentReady(ctx, sqlc.MarkAttachmentReadyParams{ID: attachment.ID, StoredSize: pgtype.Int8{Int64: size, Valid: true}})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if changed == 0 {
		w.WriteHeader(http.StatusConflict)
		return
	}
	attachment.StoredSize = pgtype.Int8{Int64: size, Valid: true}
	writeJSON(w, http.StatusOK, toAttachment(attachment, session.EmailNormalized))
}

func (h *healthHandler) AbortUpload(w http.ResponseWriter, r *http.Request, uploadId gen.UploadId) {
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
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		attachment.State = "aborted"
		h.releaseObject(ctx, q, attachment)
	}
	w.WriteHeader(http.StatusNoContent)
}

// releaseObject best-effort frees the bucket resources of an aborted or deleted
// attachment; the scheduled cleanup retries anything left behind.
func (h *healthHandler) releaseObject(ctx context.Context, q *sqlc.Queries, attachment sqlc.Attachment) {
	if h.auth.store == nil {
		return
	}
	if objectstore.Release(ctx, h.auth.store, attachment.State, attachment.ObjectKey, attachment.UploadID) == nil {
		_ = q.MarkAttachmentObjectRemoved(ctx, attachment.ID)
	}
}

func (h *healthHandler) GetAttachmentDownload(w http.ResponseWriter, r *http.Request, attachmentId openapi_types.UUID) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	store, ok := h.storage(w)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	attachment, err := q.GetAttachment(ctx, pgUUID(uuidFrom(attachmentId)))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && attachment.State != "ready") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, gen.PresignedUrl{Url: url, ExpiresInSeconds: int(downloadURLTTL.Seconds())})
}

func (h *healthHandler) DeleteAttachment(w http.ResponseWriter, r *http.Request, attachmentId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	attachment, err := q.GetAttachment(ctx, pgUUID(uuidFrom(attachmentId)))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && attachment.State != "ready") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	// The object stays 30 days (see ReleaseStorage) so a database restore still finds it.
	w.WriteHeader(http.StatusNoContent)
}

func (h *healthHandler) listAttachments(w http.ResponseWriter, r *http.Request, workItemID, conversationID pgtype.UUID) {
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
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		for _, row := range rows {
			attachments = append(attachments, toAttachment(sqlc.Attachment{
				ID: row.ID, Name: row.Name, ContentType: row.ContentType, StoredSize: row.StoredSize, CreatedAt: row.CreatedAt,
				Encrypted: row.Encrypted, NameEnc: row.NameEnc, ContentAuthorID: row.ContentAuthorID, ContentSignerDeviceID: row.ContentSignerDeviceID,
			}, row.UploaderEmail))
		}
	} else {
		rows, err := q.ListConversationAttachments(ctx, conversationID)
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		for _, row := range rows {
			attachments = append(attachments, toAttachment(sqlc.Attachment{
				ID: row.ID, Name: row.Name, ContentType: row.ContentType, StoredSize: row.StoredSize, CreatedAt: row.CreatedAt,
				Encrypted: row.Encrypted, NameEnc: row.NameEnc, ContentAuthorID: row.ContentAuthorID, ContentSignerDeviceID: row.ContentSignerDeviceID,
			}, row.UploaderEmail))
		}
	}
	writeJSON(w, http.StatusOK, attachments)
}

func (h *healthHandler) ListWorkItemAttachments(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	h.listAttachments(w, r, pgUUID(uuidFrom(workItemId)), pgtype.UUID{})
}

func (h *healthHandler) ListConversationAttachments(w http.ResponseWriter, r *http.Request, conversationId openapi_types.UUID) {
	h.listAttachments(w, r, pgtype.UUID{}, pgUUID(uuidFrom(conversationId)))
}

func (h *healthHandler) GetStorageUsage(w http.ResponseWriter, r *http.Request) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	reserved, err := q.ReservedStorage(ctx, membership.OrganizationID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, gen.StorageUsage{QuotaBytes: h.auth.quota, ReservedBytes: reserved})
}
