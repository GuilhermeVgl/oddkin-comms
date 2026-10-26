package httpapi

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
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
		channel := gen.Conversation{Id: fromPG(row.ID), Archived: &row.Archived, Name: row.Name, Unread: row.Unread, Encrypted: row.Encrypted, ContentRevision: int(row.ContentRevision)}
		if row.Encrypted {
			channel.NameEnc = blob(row.NameEnc)
			if row.ContentAuthorID.Valid {
				author := fromPG(row.ContentAuthorID)
				channel.ContentAuthorId = &author
			}
			if row.ContentSignerDeviceID.Valid {
				signer := fromPG(row.ContentSignerDeviceID)
				channel.SignerDeviceId = &signer
			}
		}
		channels = append(channels, channel)
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
		read: read, send: read && access.access.Can(work.ChatSend), manager: access.access.Manager, archived: access.archived || conversation.Archived,
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

// messageView is the common shape of a message row, whichever query produced it.
type messageView struct {
	ID                         pgtype.UUID
	Seq                        int64
	AuthorEmail, Body          string
	CreatedAt                  time.Time
	ReplyTo                    pgtype.UUID
	EditedAt, DeletedAt        pgtype.Timestamptz
	Encrypted                  bool
	BodyEnc                    []byte
	Revision                   int32
	Signer, Author, MutationID pgtype.UUID
}

func viewOf(m sqlc.Message, authorEmail string) messageView {
	return messageView{
		ID: m.ID, Seq: m.Seq, AuthorEmail: authorEmail, Body: m.Body, CreatedAt: m.CreatedAt.Time, ReplyTo: m.ReplyToID,
		EditedAt: m.EditedAt, DeletedAt: m.DeletedAt, Encrypted: m.Encrypted, BodyEnc: m.BodyEnc, Revision: m.ContentRevision,
		Signer: m.ContentSignerDeviceID, Author: m.AuthorID, MutationID: m.ClientMutationID,
	}
}

func buildMessage(m messageView, reactions []gen.ReactionSummary) gen.Message {
	message := gen.Message{
		Id: fromPG(m.ID), Seq: m.Seq, AuthorEmail: m.AuthorEmail, Body: m.Body, CreatedAt: m.CreatedAt,
		Deleted: m.DeletedAt.Valid, Reactions: reactions, Encrypted: m.Encrypted, ContentRevision: int(m.Revision),
		ClientMutationId: fromPG(m.MutationID),
	}
	if m.ReplyTo.Valid {
		replyID := fromPG(m.ReplyTo)
		message.ReplyToId = &replyID
	}
	if m.EditedAt.Valid {
		message.EditedAt = &m.EditedAt.Time
	}
	if m.Encrypted && !m.DeletedAt.Valid {
		message.BodyEnc = blob(m.BodyEnc)
		if m.Author.Valid {
			author := fromPG(m.Author)
			message.AuthorId = &author
		}
		if m.Signer.Valid {
			signer := fromPG(m.Signer)
			message.SignerDeviceId = &signer
		}
	}
	return message
}

// channelDomainFailure applies the encryption rules of a channel message write.
// A DM follows its own key domain once one has a generation (ADR 0017).
func channelDomainFailure(ctx context.Context, q *sqlc.Queries, conversation sqlc.Conversation, encrypted bool, account pgtype.UUID, signerID *pgtype.UUID) (*encContext, *encFailure, error) {
	if conversation.Kind == "dm" {
		domain, err := q.GetKeyDomainByConversation(ctx, conversation.ID)
		found := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, err
		}
		if encrypted {
			return prepareEncryptedWith(ctx, q, account, domain, found, signerID)
		}
		if found && domain.CurrentGeneration > 0 {
			return nil, &encFailure{http.StatusConflict, gen.ApiErrorCodeEncryptionRequired}, nil
		}
		return nil, nil, nil
	}
	if encrypted {
		return prepareEncrypted(ctx, q, account, conversation.ProjectID, "chat", signerID)
	}
	fail, err := requirePlaintextAllowed(ctx, q, conversation.ProjectID, "chat")
	return nil, fail, err
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
		messages = append(messages, buildMessage(messageView{
			ID: row.ID, Seq: row.Seq, AuthorEmail: row.AuthorEmail, Body: row.Body, CreatedAt: row.CreatedAt.Time, ReplyTo: row.ReplyToID,
			EditedAt: row.EditedAt, DeletedAt: row.DeletedAt, Encrypted: row.Encrypted, BodyEnc: row.BodyEnc, Revision: row.ContentRevision,
			Signer: row.ContentSignerDeviceID, Author: row.AuthorID, MutationID: row.ClientMutationID,
		}, toReactions(reactions, row.ID)))
	}
	writeJSON(w, http.StatusOK, messages)
}

func (h *healthHandler) SendMessage(w http.ResponseWriter, r *http.Request, conversationId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.SendMessageRequest
	if !decodeJSONBodyLimit(w, r, &payload, contentBodyLimit) {
		return
	}
	encrypted := payload.BodyEnc != nil
	if encrypted && (payload.SignerDeviceId == nil || payload.Body != nil) || !encrypted && payload.Body == nil {
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
		var signerID *pgtype.UUID
		if payload.SignerDeviceId != nil {
			signerID = optionalUUIDValue(pgUUID(uuidFrom(*payload.SignerDeviceId)))
		}
		writer, fail, domainErr := channelDomainFailure(ctx, q, conversation, encrypted, session.AccountID, signerID)
		if domainErr == nil && fail == nil && encrypted {
			fail = writer.verify(session.AccountID, messageResource(mutationID), 1, *payload.BodyEnc)
		}
		if domainErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if fail != nil {
			fail.write(w)
			return
		}
		if encrypted {
			bodyEnc, _ := unb64(*payload.BodyEnc, 0)
			message, err = q.CreateEncryptedMessage(ctx, sqlc.CreateEncryptedMessageParams{
				ConversationID: conversation.ID, Seq: seq, AuthorID: session.AccountID, ClientMutationID: mutationID,
				ReplyToID: optionalUUID(payload.ReplyToId), Encrypted: true, BodyEnc: bodyEnc, ContentSignerDeviceID: writer.signer.ID,
			})
		} else {
			message, err = q.CreateMessage(ctx, sqlc.CreateMessageParams{
				ConversationID: conversation.ID, Seq: seq, AuthorID: session.AccountID, Body: *payload.Body,
				ClientMutationID: mutationID, ReplyToID: optionalUUID(payload.ReplyToId),
			})
		}
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
	writeJSON(w, status, buildMessage(viewOf(message, session.EmailNormalized), toReactions(reactions, message.ID)))
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
	if !decodeJSONBodyLimit(w, r, &payload, contentBodyLimit) {
		return
	}
	encrypted := payload.BodyEnc != nil
	if encrypted && (payload.SignerDeviceId == nil || payload.ContentRevision == nil || payload.Body != nil) || !encrypted && payload.Body == nil {
		w.WriteHeader(http.StatusBadRequest)
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
	conversation, err := q.GetConversation(ctx, message.ConversationID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	var signerID *pgtype.UUID
	if payload.SignerDeviceId != nil {
		signerID = optionalUUIDValue(pgUUID(uuidFrom(*payload.SignerDeviceId)))
	}
	writer, fail, domainErr := channelDomainFailure(ctx, q, conversation, encrypted, session.AccountID, signerID)
	if domainErr == nil && fail == nil && encrypted {
		revision := int32(*payload.ContentRevision)
		if revision != message.ContentRevision+1 {
			fail = &encFailure{http.StatusConflict, gen.ApiErrorCodeBadRevision}
		} else {
			fail = writer.verify(session.AccountID, messageResource(message.ClientMutationID), revision, *payload.BodyEnc)
		}
	}
	if domainErr != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if fail != nil {
		fail.write(w)
		return
	}
	var edited sqlc.Message
	if encrypted {
		bodyEnc, _ := unb64(*payload.BodyEnc, 0)
		edited, err = q.EditEncryptedMessage(ctx, sqlc.EditEncryptedMessageParams{
			ID: message.ID, BodyEnc: bodyEnc, ContentRevision: int32(*payload.ContentRevision), ContentSignerDeviceID: writer.signer.ID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			w.WriteHeader(http.StatusConflict)
			return
		}
	} else {
		edited, err = q.EditMessage(ctx, sqlc.EditMessageParams{ID: message.ID, Body: *payload.Body})
	}
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
	writeJSON(w, http.StatusOK, buildMessage(viewOf(edited, session.EmailNormalized), toReactions(reactions, edited.ID)))
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

// UpdateConversation encrypts a channel's name (project managers only).
func (h *healthHandler) UpdateConversation(w http.ResponseWriter, r *http.Request, conversationId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.UpdateConversationRequest
	if !decodeJSONBodyLimit(w, r, &payload, contentBodyLimit) {
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
	conversation, err := q.GetConversationForUpdate(ctx, pgUUID(uuidFrom(conversationId)))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && conversation.Kind != "channel") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	access, ok := loadAccess(ctx, w, q, conversation.ProjectID, session.AccountID)
	if !ok {
		return
	}
	if !access.access.Manager {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	revision := int32(payload.ContentRevision)
	writer, fail, err := prepareEncrypted(ctx, q, session.AccountID, conversation.ProjectID, "chat", optionalUUIDValue(pgUUID(uuidFrom(payload.SignerDeviceId))))
	if err == nil && fail == nil && revision != conversation.ContentRevision+1 {
		fail = &encFailure{http.StatusConflict, gen.ApiErrorCodeBadRevision}
	}
	if err == nil && fail == nil {
		fail = writer.verify(session.AccountID, channelResource(conversation.ID), revision, payload.NameEnc)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if fail != nil {
		fail.write(w)
		return
	}
	nameEnc, _ := unb64(payload.NameEnc, 0)
	changed, err := q.SetConversationContent(ctx, sqlc.SetConversationContentParams{
		ID: conversation.ID, NameEnc: nameEnc, ContentRevision: revision, ContentAuthorID: session.AccountID, ContentSignerDeviceID: writer.signer.ID,
	})
	if err == nil && changed == 0 {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err == nil {
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
