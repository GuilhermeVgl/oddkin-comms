package httpapi

import (
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// CreateChannel adds a channel. A project that already encrypts chat gets an
// encrypted name under an id the client chose, so the id is part of what was
// signed; otherwise the name is stored in the clear until the project migrates.
func (h *healthHandler) CreateChannel(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	var payload gen.CreateChannelRequest
	if !decodeJSONBodyLimit(w, r, &payload, contentBodyLimit) {
		return
	}
	encrypted := payload.NameEnc != nil
	if encrypted && (payload.Id == nil || payload.SignerDeviceId == nil || payload.Name != nil) || !encrypted && payload.Name == nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	h.columnTx(w, r, projectId, func(ctx context.Context, q *sqlc.Queries) (int, any, error) {
		session, _ := h.activeSession(r)
		var (
			created sqlc.Conversation
			err     error
		)
		if encrypted {
			id := pgUUID(uuidFrom(*payload.Id))
			writer, fail, prepErr := prepareEncrypted(ctx, q, session.AccountID, pgUUID(projectId), "chat", optionalUUIDValue(pgUUID(uuidFrom(*payload.SignerDeviceId))))
			if prepErr != nil {
				return 0, nil, prepErr
			}
			if fail == nil {
				fail = writer.verify(session.AccountID, channelResource(id), 1, *payload.NameEnc)
			}
			if fail != nil {
				return fail.status, nil, nil
			}
			nameEnc, _ := unb64(*payload.NameEnc, 0)
			created, err = q.CreateEncryptedConversation(ctx, sqlc.CreateEncryptedConversationParams{
				ID: id, ProjectID: pgUUID(projectId), NameEnc: nameEnc, ContentAuthorID: session.AccountID, ContentSignerDeviceID: writer.signer.ID,
			})
		} else {
			name, ok := validColumnName(*payload.Name)
			if !ok {
				return http.StatusBadRequest, nil, nil
			}
			fail, planErr := requirePlaintextAllowed(ctx, q, pgUUID(projectId), "chat")
			if planErr != nil {
				return 0, nil, planErr
			}
			if fail != nil {
				return fail.status, nil, nil
			}
			created, err = q.CreateConversation(ctx, sqlc.CreateConversationParams{ProjectID: pgUUID(projectId), Name: name})
		}
		if isConstraintViolation(err) {
			return http.StatusBadRequest, nil, nil
		}
		if err != nil {
			return 0, nil, err
		}
		archived := false
		channel := gen.Conversation{Id: fromPG(created.ID), Name: created.Name, Encrypted: created.Encrypted, ContentRevision: int(created.ContentRevision), Archived: &archived}
		if created.Encrypted {
			channel.NameEnc = blob(created.NameEnc)
			signer := fromPG(created.ContentSignerDeviceID)
			author := fromPG(created.ContentAuthorID)
			channel.SignerDeviceId, channel.ContentAuthorId = &signer, &author
		}
		return http.StatusCreated, channel, nil
	})
}

// ReorderChannels takes the complete list so a stale client cannot drop a channel.
func (h *healthHandler) ReorderChannels(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	var payload gen.ReorderRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	h.columnTx(w, r, projectId, func(ctx context.Context, q *sqlc.Queries) (int, any, error) {
		current, err := q.ListChannelIDs(ctx, pgUUID(projectId))
		if err != nil {
			return 0, nil, err
		}
		sortIDs := func(ids [][16]byte) [][16]byte {
			slices.SortFunc(ids, func(a, b [16]byte) int { return slices.Compare(a[:], b[:]) })
			return ids
		}
		have, wanted := make([][16]byte, 0, len(current)), make([][16]byte, 0, len(payload.Ids))
		for _, id := range current {
			have = append(have, id.Bytes)
		}
		for _, id := range payload.Ids {
			wanted = append(wanted, uuidFrom(id))
		}
		if !slices.Equal(sortIDs(have), sortIDs(slices.Clone(wanted))) {
			return http.StatusBadRequest, nil, nil
		}
		for position, id := range payload.Ids {
			if err = q.SetConversationPosition(ctx, sqlc.SetConversationPositionParams{ID: pgUUID(uuidFrom(id)), ProjectID: pgUUID(projectId), Position: int32(position)}); err != nil {
				return 0, nil, err
			}
		}
		return http.StatusNoContent, nil, nil
	})
}

// SetChannelArchived makes a channel read-only, or writable again.
func (h *healthHandler) SetChannelArchived(w http.ResponseWriter, r *http.Request, conversationId openapi_types.UUID) {
	var payload gen.ArchiveRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	conversation, chat, ok := conversationAccess(ctx, w, q, conversationId, session.AccountID)
	if !ok {
		return
	}
	if conversation.Kind != "channel" {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if !chat.manager {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if chat.archived && !conversation.Archived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if _, err = q.SetConversationArchived(ctx, sqlc.SetConversationArchivedParams{ID: conversation.ID, Archived: payload.Archived}); err == nil {
		err = announceProjectChanged(ctx, q, conversation.ProjectID)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SetProjectArchived hides a project from the default lists and makes it read-only.
func (h *healthHandler) SetProjectArchived(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	var payload gen.ArchiveRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	access, ok := loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID)
	if !ok {
		return
	}
	if !access.access.Manager {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if err = q.LockProject(ctx, pgUUID(projectId)); err == nil {
		var recipients []pgtype.UUID
		recipients, err = projectRecipients(ctx, q, pgUUID(projectId), "")
		if err == nil {
			err = q.SetProjectArchived(ctx, sqlc.SetProjectArchivedParams{ID: pgUUID(projectId), Archived: payload.Archived})
		}
		if err == nil {
			err = emitEvent(ctx, q, recipients, eventSpec{Type: "project.changed", ResourceID: pgUUID(projectId), ProjectID: pgUUID(projectId)})
		}
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
