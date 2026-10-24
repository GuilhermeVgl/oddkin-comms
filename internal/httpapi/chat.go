package httpapi

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/oddkin-comms/internal/work"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

const maxMessagePage = 100

// chatAccess is what an account may do in one conversation, channel or DM.
type chatAccess struct {
	read, send, manager, archived bool
}

func (h *healthHandler) ListConversations(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
	if !access.access.Can(work.ChatRead) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	rows, err := q.ListConversations(ctx, sqlc.ListConversationsParams{ProjectID: pgUUID(projectId), AccountID: session.AccountID})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	channels := make([]gen.Conversation, 0, len(rows))
	for _, row := range rows {
		channels = append(channels, gen.Conversation{Id: fromPG(row.ID), Name: row.Name, Unread: row.Unread})
	}
	writeJSON(w, http.StatusOK, channels)
}

// conversationAccess resolves a conversation and the caller's rights in it.
// Channels of foreign projects and DMs of other people answer 404.
func conversationAccess(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, id openapi_types.UUID, accountID pgtype.UUID) (sqlc.Conversation, chatAccess, bool) {
	conversation, err := q.GetConversation(ctx, pgUUID(uuidFrom(id)))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return conversation, chatAccess{}, false
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return conversation, chatAccess{}, false
	}
	return resolveChatAccess(ctx, w, q, conversation, accountID)
}

func resolveChatAccess(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, conversation sqlc.Conversation, accountID pgtype.UUID) (sqlc.Conversation, chatAccess, bool) {
	if conversation.Kind == "dm" {
		if accountID != conversation.DmLow && accountID != conversation.DmHigh {
			w.WriteHeader(http.StatusNotFound)
			return conversation, chatAccess{}, false
		}
		allowed, err := q.DirectMessagesAllowed(ctx, sqlc.DirectMessagesAllowedParams{First: conversation.DmLow, Second: conversation.DmHigh})
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return conversation, chatAccess{}, false
		}
		return conversation, chatAccess{read: allowed, send: allowed}, true
	}
	access, ok := loadAccess(ctx, w, q, conversation.ProjectID, accountID)
	if !ok {
		return conversation, chatAccess{}, false
	}
	read := access.access.Can(work.ChatRead)
	return conversation, chatAccess{
		read: read, send: read && access.access.Can(work.ChatSend), manager: access.access.Manager, archived: access.archived,
	}, true
}

func toReactions(rows []sqlc.ListReactionsRow, messageID pgtype.UUID) []gen.ReactionSummary {
	summaries := []gen.ReactionSummary{}
	for _, row := range rows {
		if row.MessageID == messageID {
			summaries = append(summaries, gen.ReactionSummary{Emoji: row.Emoji, Count: int(row.Total), Mine: row.Mine})
		}
	}
	return summaries
}

func buildMessage(id pgtype.UUID, seq int64, authorEmail, body string, createdAt time.Time, reply pgtype.UUID, edited, deleted pgtype.Timestamptz, reactions []gen.ReactionSummary) gen.Message {
	message := gen.Message{
		Id: fromPG(id), Seq: seq, AuthorEmail: authorEmail, Body: body, CreatedAt: createdAt,
		Deleted: deleted.Valid, Reactions: reactions,
	}
	if reply.Valid {
		replyID := fromPG(reply)
		message.ReplyToId = &replyID
	}
	if edited.Valid {
		message.EditedAt = &edited.Time
	}
	return message
}

func (h *healthHandler) ListMessages(w http.ResponseWriter, r *http.Request, conversationId openapi_types.UUID, params gen.ListMessagesParams) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	conversation, access, ok := conversationAccess(ctx, w, q, conversationId, session.AccountID)
	if !ok {
		return
	}
	if !access.read {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var after int64
	if params.After != nil {
		after = *params.After
	}
	limit := 50
	if params.Limit != nil && *params.Limit >= 1 && *params.Limit <= maxMessagePage {
		limit = *params.Limit
	}
	rows, err := q.ListMessages(ctx, sqlc.ListMessagesParams{ConversationID: conversation.ID, Seq: after, Limit: int32(limit)})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	ids := make([]pgtype.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	reactions, err := q.ListReactions(ctx, sqlc.ListReactionsParams{Me: session.AccountID, Ids: ids})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	messages := make([]gen.Message, 0, len(rows))
	for _, row := range rows {
		messages = append(messages, buildMessage(row.ID, row.Seq, row.AuthorEmail, row.Body, row.CreatedAt.Time, row.ReplyToID, row.EditedAt, row.DeletedAt, toReactions(reactions, row.ID)))
	}
	writeJSON(w, http.StatusOK, messages)
}

func (h *healthHandler) SendMessage(w http.ResponseWriter, r *http.Request, conversationId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.SendMessageRequest
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
	conversation, access, ok := conversationAccess(ctx, w, q, conversationId, session.AccountID)
	if !ok {
		return
	}
	if !access.send {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if access.archived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	// The row lock serializes senders, so sequence numbers have no gaps and a
	// retried clientMutationId is detected before a new sequence is consumed.
	if _, err = q.LockConversation(ctx, conversation.ID); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	mutationID := pgUUID(uuidFrom(payload.ClientMutationId))
	existing, err := q.FindMessageByMutation(ctx, sqlc.FindMessageByMutationParams{
		ConversationID: conversation.ID, AuthorID: session.AccountID, ClientMutationID: mutationID,
	})
	status := http.StatusOK
	message := existing
	if errors.Is(err, pgx.ErrNoRows) {
		seq, seqErr := q.NextMessageSeq(ctx, conversation.ID)
		if seqErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		message, err = q.CreateMessage(ctx, sqlc.CreateMessageParams{
			ConversationID: conversation.ID, Seq: seq, AuthorID: session.AccountID, Body: payload.Body,
			ClientMutationID: mutationID, ReplyToID: optionalUUID(payload.ReplyToId),
		})
		if isConstraintViolation(err) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		status = http.StatusCreated
		if err == nil {
			err = announceMessage(ctx, q, conversation, message, session.AccountID, payload.MentionIds)
		}
		if errors.Is(err, errInvalidMention) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	reactions, err := q.ListReactions(ctx, sqlc.ListReactionsParams{Me: session.AccountID, Ids: []pgtype.UUID{message.ID}})
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, status, buildMessage(message.ID, message.Seq, session.EmailNormalized, message.Body, message.CreatedAt.Time, message.ReplyToID, message.EditedAt, message.DeletedAt, toReactions(reactions, message.ID)))
}

// messageAccess locks the message and resolves the caller's rights in its conversation.
func messageAccess(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, id openapi_types.UUID, accountID pgtype.UUID) (sqlc.Message, chatAccess, bool) {
	message, err := q.GetMessageForUpdate(ctx, pgUUID(uuidFrom(id)))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return message, chatAccess{}, false
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return message, chatAccess{}, false
	}
	conversation, err := q.GetConversation(ctx, message.ConversationID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return message, chatAccess{}, false
	}
	_, access, ok := resolveChatAccess(ctx, w, q, conversation, accountID)
	if ok && !access.read {
		w.WriteHeader(http.StatusForbidden)
		return message, access, false
	}
	return message, access, ok
}

func (h *healthHandler) EditMessage(w http.ResponseWriter, r *http.Request, messageId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.EditMessageRequest
	if !decodeJSONBody(w, r, &payload) {
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
	message, access, ok := messageAccess(ctx, w, q, messageId, session.AccountID)
	if !ok {
		return
	}
	if message.AuthorID != session.AccountID || !access.send {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if message.DeletedAt.Valid || access.archived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	edited, err := q.EditMessage(ctx, sqlc.EditMessageParams{ID: message.ID, Body: payload.Body})
	if isConstraintViolation(err) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	err = emitForMessage(ctx, q, "message.updated", edited)
	var reactions []sqlc.ListReactionsRow
	if err == nil {
		reactions, err = q.ListReactions(ctx, sqlc.ListReactionsParams{Me: session.AccountID, Ids: []pgtype.UUID{edited.ID}})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, buildMessage(edited.ID, edited.Seq, session.EmailNormalized, edited.Body, edited.CreatedAt.Time, edited.ReplyToID, edited.EditedAt, edited.DeletedAt, toReactions(reactions, edited.ID)))
}

func (h *healthHandler) DeleteMessage(w http.ResponseWriter, r *http.Request, messageId openapi_types.UUID) {
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
	message, access, ok := messageAccess(ctx, w, q, messageId, session.AccountID)
	if !ok {
		return
	}
	// Managers moderate channels only; nobody moderates a DM they did not write.
	if message.AuthorID != session.AccountID && !access.manager {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if !message.DeletedAt.Valid {
		if err = q.DeleteMessage(ctx, message.ID); err == nil {
			err = q.DeleteMessageReactions(ctx, message.ID)
		}
		if err == nil {
			err = emitForMessage(ctx, q, "message.deleted", message)
		}
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
	}
	if err = tx.Commit(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *healthHandler) ToggleReaction(w http.ResponseWriter, r *http.Request, messageId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.ToggleReactionRequest
	if !decodeJSONBody(w, r, &payload) {
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
	message, access, ok := messageAccess(ctx, w, q, messageId, session.AccountID)
	if !ok {
		return
	}
	if !access.send {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if message.DeletedAt.Valid || access.archived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	added, err := q.AddReaction(ctx, sqlc.AddReactionParams{MessageID: message.ID, AccountID: session.AccountID, Emoji: payload.Emoji})
	if isConstraintViolation(err) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err == nil && added == 0 {
		_, err = q.RemoveReaction(ctx, sqlc.RemoveReactionParams{MessageID: message.ID, AccountID: session.AccountID, Emoji: payload.Emoji})
	}
	if err == nil {
		err = emitForMessage(ctx, q, "reaction.changed", message)
	}
	var reactions []sqlc.ListReactionsRow
	if err == nil {
		reactions, err = q.ListReactions(ctx, sqlc.ListReactionsParams{Me: session.AccountID, Ids: []pgtype.UUID{message.ID}})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, toReactions(reactions, message.ID))
}

func (h *healthHandler) ListDirectContacts(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := sqlc.New(h.auth.pool).ListDirectContacts(ctx, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	contacts := make([]gen.DirectContact, 0, len(rows))
	for _, row := range rows {
		contacts = append(contacts, gen.DirectContact{AccountId: fromPG(row.AccountID), Email: row.EmailNormalized})
	}
	writeJSON(w, http.StatusOK, contacts)
}

func (h *healthHandler) ListDirectConversations(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := sqlc.New(h.auth.pool).ListDirectConversations(ctx, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	conversations := make([]gen.DirectConversation, 0, len(rows))
	for _, row := range rows {
		conversations = append(conversations, gen.DirectConversation{Id: fromPG(row.ID), PeerId: fromPG(row.PeerID), PeerEmail: row.PeerEmail, Unread: row.Unread})
	}
	writeJSON(w, http.StatusOK, conversations)
}

func (h *healthHandler) OpenDirectConversation(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.OpenDirectConversationRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	peer := pgUUID(uuidFrom(payload.AccountId))
	if peer == session.AccountID {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	allowed, err := q.DirectMessagesAllowed(ctx, sqlc.DirectMessagesAllowedParams{First: session.AccountID, Second: peer})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if !allowed {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	low, high := session.AccountID, peer
	if string(high.Bytes[:]) < string(low.Bytes[:]) {
		low, high = high, low
	}
	conversation, err := q.EnsureDirectConversation(ctx, sqlc.EnsureDirectConversationParams{DmLow: low, DmHigh: high})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	account, err := q.GetAccountByID(ctx, peer)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	status := http.StatusOK
	if conversation.Created {
		status = http.StatusCreated
	}
	writeJSON(w, status, gen.DirectConversation{Id: fromPG(conversation.ID), PeerId: fromPG(peer), PeerEmail: account.EmailNormalized, Unread: 0})
}

var errInvalidMention = errors.New("mention outside the conversation")

// announceMessage fans out message.created and the notifications it implies.
// Mentions must reference people who can read the conversation.
func announceMessage(ctx context.Context, q *sqlc.Queries, conversation sqlc.Conversation, message sqlc.Message, author pgtype.UUID, mentionIDs *[]openapi_types.UUID) error {
	recipients, err := conversationRecipients(ctx, q, conversation)
	if err != nil {
		return err
	}
	if err = emitEvent(ctx, q, recipients, eventSpec{
		Type: "message.created", ResourceID: message.ID, ProjectID: conversation.ProjectID, ConversationID: conversation.ID,
	}); err != nil {
		return err
	}
	notified := map[pgtype.UUID]bool{author: true}
	if mentionIDs != nil {
		for _, id := range *mentionIDs {
			mentioned := pgUUID(uuidFrom(id))
			if !slices.Contains(recipients, mentioned) {
				return errInvalidMention
			}
			if notified[mentioned] {
				continue
			}
			notified[mentioned] = true
			if err = notifyAccount(ctx, q, mentioned, "mention", message.ID, conversation.ProjectID, conversation.ID); err != nil {
				return err
			}
		}
	}
	if conversation.Kind == "dm" {
		for _, peer := range recipients {
			if notified[peer] {
				continue
			}
			if err = notifyAccount(ctx, q, peer, "direct_message", message.ID, pgtype.UUID{}, conversation.ID); err != nil {
				return err
			}
		}
	}
	return nil
}
