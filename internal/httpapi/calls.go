package httpapi

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/calls"
	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/keys"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/livekit/protocol/webhook"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

const callTokenTTL = 5 * time.Minute

// callRights is what an account may do with calls in one conversation.
type callRights struct {
	conversation sqlc.Conversation
	archived     bool
	manager      bool
	join         bool
	start        bool
	screen       bool
}

// resolveCallRights answers 404 for conversations the account cannot see. DMs
// follow the eligibility of the pair; channels follow the project policy.
func resolveCallRights(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, conversationID, accountID pgtype.UUID) (callRights, bool) {
	var rights callRights
	conversation, err := q.GetConversation(ctx, conversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return rights, false
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return rights, false
	}
	conversation, chat, ok := resolveChatAccess(ctx, w, q, conversation, accountID)
	if !ok {
		return rights, false
	}
	rights.conversation, rights.archived = conversation, chat.archived
	if conversation.Kind == "dm" {
		rights.join, rights.start, rights.screen = chat.read, chat.read, chat.read
		return rights, true
	}
	access, found := loadAccess(ctx, w, q, conversation.ProjectID, accountID)
	if !found {
		return rights, false
	}
	rights.manager = access.access.Manager
	rights.join = chat.read && access.access.Can(work.CallsJoin)
	rights.start = rights.join && access.access.Can(work.CallsStart)
	rights.screen = rights.join && access.access.Can(work.CallsScreenShare)
	return rights, true
}

func (h *healthHandler) mediaConfigured(w http.ResponseWriter) bool {
	if h.auth == nil || h.auth.rooms == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return false
	}
	return true
}

func writeConflict(w http.ResponseWriter, code gen.CallConflictCode) {
	writeJSON(w, http.StatusConflict, gen.CallConflict{Code: code})
}

func newRoomName() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "call-" + hex.EncodeToString(raw), nil
}

// eligibleInvitees are people who can read the conversation and join calls in it.
func eligibleInvitees(ctx context.Context, q *sqlc.Queries, conversation sqlc.Conversation) ([]pgtype.UUID, error) {
	if conversation.Kind == "dm" {
		return []pgtype.UUID{conversation.DmLow, conversation.DmHigh}, nil
	}
	readers, err := projectRecipients(ctx, q, conversation.ProjectID, work.ChatRead)
	if err != nil {
		return nil, err
	}
	joiners, err := projectRecipients(ctx, q, conversation.ProjectID, work.CallsJoin)
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(readers, func(id pgtype.UUID) bool { return !slices.Contains(joiners, id) }), nil
}

// callKeyState derives, from who holds a seat and who holds the current key,
// whether media may keep flowing: someone who left and still holds the key
// forces a rotation; someone who joined without it makes the call wait for one.
func callKeyState(ctx context.Context, q *sqlc.Queries, call sqlc.Call) (string, error) {
	if call.KeyGeneration == 0 {
		return "pending_keys", nil
	}
	seats, err := q.ListSeatDevices(ctx, call.ID)
	if err != nil {
		return "", err
	}
	holders, err := q.ListCallKeyHolders(ctx, sqlc.ListCallKeyHoldersParams{CallID: call.ID, Generation: call.KeyGeneration})
	if err != nil {
		return "", err
	}
	if slices.ContainsFunc(holders, func(id pgtype.UUID) bool { return !slices.Contains(seats, id) }) {
		return "rotation_required", nil
	}
	if slices.ContainsFunc(seats, func(id pgtype.UUID) bool { return !slices.Contains(holders, id) }) {
		return "pending_keys", nil
	}
	return "ok", nil
}

func buildCall(ctx context.Context, q *sqlc.Queries, call sqlc.Call, rights callRights, me pgtype.UUID) (gen.Call, error) {
	participants, err := q.ListCallParticipants(ctx, call.ID)
	if err != nil {
		return gen.Call{}, err
	}
	invitations, err := q.ListCallInvitations(ctx, call.ID)
	if err != nil {
		return gen.Call{}, err
	}
	starter := ""
	if call.StartedBy.Valid {
		account, accountErr := q.GetAccountByID(ctx, call.StartedBy)
		if accountErr == nil {
			starter = account.EmailNormalized
		}
	}
	keyState, err := callKeyState(ctx, q, call)
	if err != nil {
		return gen.Call{}, err
	}
	response := gen.Call{
		KeyGeneration: int(call.KeyGeneration), KeyState: gen.CallKeyState(keyState),
		Id: fromPG(call.ID), ConversationId: fromPG(call.ConversationID), State: gen.CallState(call.State),
		StartedBy: starter, MaxParticipants: calls.MaxParticipants,
		Participants: []gen.CallParticipant{}, Invitations: []gen.CallInvitationState{},
		CanEnd: call.State == "active" && (call.StartedBy == me || (rights.conversation.Kind == "channel" && rights.manager)),
	}
	if call.ScreenSharerID.Valid {
		sharer := fromPG(call.ScreenSharerID)
		response.ScreenSharerId = &sharer
	}
	for _, participant := range participants {
		response.Participants = append(response.Participants, gen.CallParticipant{
			AccountId: fromPG(participant.AccountID), Email: participant.EmailNormalized, State: gen.CallParticipantState(participant.State),
		})
	}
	for _, invitation := range invitations {
		response.Invitations = append(response.Invitations, gen.CallInvitationState{
			AccountId: fromPG(invitation.AccountID), Email: invitation.EmailNormalized, State: gen.CallInvitationStateState(invitation.State),
		})
		if invitation.AccountID == me && invitation.State == "pending" {
			response.InvitedMe = true
		}
	}
	return response, nil
}

func (h *healthHandler) StartCall(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !h.mediaConfigured(w) {
		return
	}
	var payload gen.StartCallRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	room, err := newRoomName()
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	rights, ok := resolveCallRights(ctx, w, q, pgUUID(uuidFrom(payload.ConversationId)), session.AccountID)
	if !ok {
		return
	}
	if !rights.start {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if rights.archived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	eligible, err := eligibleInvitees(ctx, q, rights.conversation)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	var invitees []pgtype.UUID
	if payload.InviteeIds != nil {
		for _, id := range *payload.InviteeIds {
			invitee := pgUUID(uuidFrom(id))
			if invitee == session.AccountID || !slices.Contains(eligible, invitee) || slices.Contains(invitees, invitee) {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			invitees = append(invitees, invitee)
		}
	}
	if rights.conversation.Kind == "dm" && len(invitees) == 0 {
		for _, id := range eligible {
			if id != session.AccountID {
				invitees = append(invitees, id)
			}
		}
	}
	call, err := q.CreateCall(ctx, sqlc.CreateCallParams{ConversationID: rights.conversation.ID, StartedBy: session.AccountID, RoomName: room})
	if isUniqueViolation(err) {
		w.WriteHeader(http.StatusConflict)
		return
	}
	for _, invitee := range invitees {
		if err != nil {
			break
		}
		err = q.UpsertCallInvitation(ctx, sqlc.UpsertCallInvitationParams{CallID: call.ID, AccountID: invitee})
		if err == nil {
			err = notifyAccount(ctx, q, invitee, "call_invite", call.ID, rights.conversation.ProjectID, rights.conversation.ID)
		}
	}
	if err == nil && len(invitees) > 0 {
		err = emitEvent(ctx, q, invitees, eventSpec{Type: "call.invited", ResourceID: call.ID, ProjectID: rights.conversation.ProjectID, ConversationID: rights.conversation.ID})
	}
	if err == nil {
		err = calls.Announce(ctx, q, call)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	// Media-server effect after commit; on failure close the call again.
	if err = h.auth.rooms.CreateRoom(ctx, room, calls.MaxParticipants); err != nil {
		h.closeCall(ctx, call, "room_unavailable")
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	reader := sqlc.New(h.auth.pool)
	response, err := buildCall(ctx, reader, call, rights, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

// closeCall ends a call in its own transaction (used after external failures).
func (h *healthHandler) closeCall(ctx context.Context, call sqlc.Call, reason string) {
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err = calls.End(ctx, sqlc.New(tx), call, reason); err == nil {
		_ = tx.Commit(ctx)
	}
}

func (h *healthHandler) ListActiveCalls(w http.ResponseWriter, r *http.Request, params gen.ListActiveCallsParams) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	rights, ok := resolveCallRights(ctx, w, q, pgUUID(uuidFrom(params.ConversationId)), session.AccountID)
	if !ok {
		return
	}
	result := []gen.Call{}
	if rights.join {
		call, err := q.ActiveCallForConversation(ctx, rights.conversation.ID)
		if err == nil {
			built, buildErr := buildCall(ctx, q, call, rights, session.AccountID)
			if buildErr != nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			result = append(result, built)
		} else if !errors.Is(err, pgx.ErrNoRows) {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *healthHandler) ListCallInvitations(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	rows, err := q.ListPendingCallInvitations(ctx, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	result := []gen.CallInvitation{}
	for _, row := range rows {
		visible, authErr := canReceive(ctx, q, session.AccountID, pgtype.UUID{}, row.ConversationID, work.ChatRead)
		if authErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if visible {
			result = append(result, gen.CallInvitation{CallId: fromPG(row.CallID), ConversationId: fromPG(row.ConversationID), StartedBy: row.StartedByEmail, CreatedAt: row.CreatedAt.Time})
		}
	}
	writeJSON(w, http.StatusOK, result)
}

// loadCall resolves a call and the caller's rights, answering 404 otherwise.
func loadCall(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, id openapi_types.UUID, account pgtype.UUID, lock bool) (sqlc.Call, callRights, bool) {
	var (
		call sqlc.Call
		err  error
	)
	if lock {
		call, err = q.LockCall(ctx, pgUUID(uuidFrom(id)))
	} else {
		call, err = q.GetCall(ctx, pgUUID(uuidFrom(id)))
	}
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return call, callRights{}, false
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return call, callRights{}, false
	}
	rights, ok := resolveCallRights(ctx, w, q, call.ConversationID, account)
	return call, rights, ok
}

func (h *healthHandler) GetCall(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	call, rights, ok := loadCall(ctx, w, q, callId, session.AccountID, false)
	if !ok {
		return
	}
	if !rights.join {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	response, err := buildCall(ctx, q, call, rights, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *healthHandler) ticket(call sqlc.Call, session sqlc.FindActiveSessionByTokenHashRow, screenShare bool) (gen.CallTicket, error) {
	identity := uuid.UUID(session.AccountID.Bytes).String()
	token, err := h.auth.livekit.JoinToken(call.RoomName, identity, session.EmailNormalized, screenShare, callTokenTTL)
	if err != nil {
		return gen.CallTicket{}, err
	}
	return gen.CallTicket{
		Url: h.auth.livekit.URL, Token: token, Identity: identity,
		ExpiresInSeconds: int(callTokenTTL.Seconds()), ReservedForSeconds: calls.ReservationSeconds,
	}, nil
}

func (h *healthHandler) JoinCall(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !h.mediaConfigured(w) {
		return
	}
	var payload gen.JoinCallRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	transfer := payload.Transfer != nil && *payload.Transfer
	deviceID := pgUUID(uuidFrom(payload.DeviceId))
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	// The call row lock serializes concurrent admissions: the seat count and
	// the insert below are one atomic decision.
	call, rights, ok := loadCall(ctx, w, q, callId, session.AccountID, true)
	if !ok {
		return
	}
	if !rights.join {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	// Media is end-to-end encrypted: a seat needs an active device of the caller
	// to seal the call key for. There is no unencrypted way in.
	device, deviceErr := q.GetDevice(ctx, deviceID)
	if errors.Is(deviceErr, pgx.ErrNoRows) || (deviceErr == nil && (device.AccountID != session.AccountID || device.State != "active" || device.Kind != "device")) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if deviceErr != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if call.State != "active" {
		writeConflict(w, gen.CallEnded)
		return
	}
	invited := call.StartedBy == session.AccountID
	invitation, invErr := q.GetCallInvitation(ctx, sqlc.GetCallInvitationParams{CallID: call.ID, AccountID: session.AccountID})
	if invErr == nil && (invitation.State == "pending" || invitation.State == "accepted") {
		invited = true
	} else if invErr != nil && !errors.Is(invErr, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if !invited {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if err = q.ExpireStaleAdmissionsForAccount(ctx, session.AccountID); err == nil {
		err = q.ExpireStaleAdmissionsForCall(ctx, call.ID)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	existing, err := q.ActiveAdmissionForAccount(ctx, session.AccountID)
	switch {
	case err == nil && existing.CallID != call.ID:
		writeConflict(w, gen.InOtherCall)
		return
	case err == nil:
		// Same call: a reconnect of this session renews the seat; another
		// device must ask to take it over explicitly.
		if existing.SessionID != session.ID && !transfer {
			writeConflict(w, gen.OtherDevice)
			return
		}
		_, err = q.RenewAdmission(ctx, sqlc.RenewAdmissionParams{ID: existing.ID, SessionID: session.ID, DeviceID: deviceID, Seconds: float64(calls.ReservationSeconds)})
	case errors.Is(err, pgx.ErrNoRows):
		seats, countErr := q.CountCallSeats(ctx, call.ID)
		if countErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if seats >= calls.MaxParticipants {
			writeConflict(w, gen.CallFull)
			return
		}
		_, err = q.InsertAdmission(ctx, sqlc.InsertAdmissionParams{CallID: call.ID, AccountID: session.AccountID, SessionID: session.ID, DeviceID: deviceID, Seconds: float64(calls.ReservationSeconds)})
	}
	if isUniqueViolation(err) {
		writeConflict(w, gen.InOtherCall)
		return
	}
	if err == nil && invErr == nil {
		_, err = q.SetCallInvitationState(ctx, sqlc.SetCallInvitationStateParams{CallID: call.ID, AccountID: session.AccountID, State: "accepted"})
	}
	if err == nil {
		err = calls.Announce(ctx, q, call)
	}
	var ticket gen.CallTicket
	if err == nil {
		ticket, err = h.ticket(call, session, call.ScreenSharerID == session.AccountID)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, ticket)
}

func (h *healthHandler) DeclineCall(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
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
	call, _, ok := loadCall(ctx, w, q, callId, session.AccountID, true)
	if !ok {
		return
	}
	changed, err := q.SetCallInvitationState(ctx, sqlc.SetCallInvitationStateParams{CallID: call.ID, AccountID: session.AccountID, State: "declined"})
	if err == nil && changed == 0 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err == nil {
		err = calls.Announce(ctx, q, call)
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

func (h *healthHandler) CancelCallInvitation(w http.ResponseWriter, r *http.Request, callId gen.CallId, accountId openapi_types.UUID) {
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
	call, _, ok := loadCall(ctx, w, q, callId, session.AccountID, true)
	if !ok {
		return
	}
	if call.StartedBy != session.AccountID {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	changed, err := q.SetCallInvitationState(ctx, sqlc.SetCallInvitationStateParams{CallID: call.ID, AccountID: pgUUID(uuidFrom(accountId)), State: "cancelled"})
	if err == nil && changed == 0 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err == nil {
		err = calls.Announce(ctx, q, call)
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

func (h *healthHandler) LeaveCall(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	call, _, ok := loadCall(ctx, w, q, callId, session.AccountID, true)
	if !ok {
		return
	}
	ended := false
	if call.State == "active" {
		if ended, err = calls.ParticipantLeft(ctx, q, call, session.AccountID); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
	}
	if err = tx.Commit(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if h.auth.rooms != nil {
		identity := uuid.UUID(session.AccountID.Bytes).String()
		if ended {
			_ = h.auth.rooms.DeleteRoom(ctx, call.RoomName)
		} else {
			_ = h.auth.rooms.Remove(ctx, call.RoomName, identity)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *healthHandler) EndCall(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	call, rights, ok := loadCall(ctx, w, q, callId, session.AccountID, true)
	if !ok {
		return
	}
	// The initiator or, in a channel, a project manager may end the call. In a
	// DM the other person leaves instead.
	if call.StartedBy != session.AccountID && (rights.conversation.Kind != "channel" || !rights.manager) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	ended, err := calls.End(ctx, q, call, "ended")
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if ended && h.auth.rooms != nil {
		_ = h.auth.rooms.DeleteRoom(ctx, call.RoomName)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *healthHandler) StartScreenShare(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !h.mediaConfigured(w) {
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
	call, rights, ok := loadCall(ctx, w, q, callId, session.AccountID, true)
	if !ok {
		return
	}
	if !rights.screen {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if call.State != "active" {
		writeConflict(w, gen.CallEnded)
		return
	}
	seat, err := q.ActiveAdmissionForAccount(ctx, session.AccountID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && seat.CallID != call.ID) {
		writeConflict(w, gen.NotInCall)
		return
	}
	var taken int64
	if err == nil {
		taken, err = q.AcquireScreenShare(ctx, sqlc.AcquireScreenShareParams{ID: call.ID, ScreenSharerID: session.AccountID})
	}
	if err == nil && taken == 0 {
		writeConflict(w, gen.ScreenShareTaken)
		return
	}
	var ticket gen.CallTicket
	if err == nil {
		err = calls.Announce(ctx, q, call)
	}
	if err == nil {
		ticket, err = h.ticket(call, session, true)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	// The slot is ours; now let LiveKit accept the screen from this person,
	// outside any database lock. If it cannot, give the slot back.
	if grantErr := h.auth.rooms.SetScreenShare(ctx, call.RoomName, uuid.UUID(session.AccountID.Bytes).String(), true); grantErr != nil {
		_ = sqlc.New(h.auth.pool).ReleaseScreenShare(ctx, sqlc.ReleaseScreenShareParams{ID: call.ID, ScreenSharerID: session.AccountID})
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, ticket)
}

func (h *healthHandler) StopScreenShare(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
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
	call, _, ok := loadCall(ctx, w, q, callId, session.AccountID, true)
	if !ok {
		return
	}
	err = q.ReleaseScreenShare(ctx, sqlc.ReleaseScreenShareParams{ID: call.ID, ScreenSharerID: session.AccountID})
	if err == nil {
		err = calls.Announce(ctx, q, call)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if h.auth.rooms != nil {
		_ = h.auth.rooms.SetScreenShare(ctx, call.RoomName, uuid.UUID(session.AccountID.Bytes).String(), false)
	}
	w.WriteHeader(http.StatusNoContent)
}

// LivekitWebhook verifies the signature, ignores replays and reconciles presence.
func (h *healthHandler) LivekitWebhook(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil || h.auth.rooms == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	event, err := webhook.ReceiveWebhookEvent(r, h.auth.livekit.KeyProvider())
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	if event.GetId() != "" {
		fresh, recordErr := q.RecordWebhookEvent(ctx, event.GetId())
		if recordErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if fresh == 0 {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	roomName := event.GetRoom().GetName()
	call, err := q.GetCallByRoom(ctx, roomName)
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err == nil {
		call, err = q.LockCall(ctx, call.ID)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	var kick, deleteRoom bool
	identity := event.GetParticipant().GetIdentity()
	account, parseErr := uuid.Parse(identity)
	switch event.GetEvent() {
	case "participant_joined":
		if parseErr != nil {
			kick = true
		} else if kick, err = calls.ParticipantJoined(ctx, q, call, pgUUID(account)); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
	case "participant_left":
		if parseErr == nil && call.State == "active" {
			if deleteRoom, err = calls.ParticipantLeft(ctx, q, call, pgUUID(account)); err != nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
		}
	case "room_finished":
		if _, err = calls.End(ctx, q, call, "room_finished"); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
	}
	if err = tx.Commit(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if kick {
		_ = h.auth.rooms.Remove(ctx, roomName, identity)
	}
	if deleteRoom {
		_ = h.auth.rooms.DeleteRoom(ctx, roomName)
	}
	w.WriteHeader(http.StatusNoContent)
}

// seatOf returns the caller's seat in this call, answering 403 otherwise.
func seatOf(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, call sqlc.Call, account pgtype.UUID) (sqlc.CallAdmission, bool) {
	if err := q.ExpireStaleAdmissionsForCall(ctx, call.ID); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return sqlc.CallAdmission{}, false
	}
	seat, err := q.ActiveAdmissionForAccount(ctx, account)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (seat.CallID != call.ID || !seat.DeviceID.Valid)) {
		w.WriteHeader(http.StatusForbidden)
		return seat, false
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return seat, false
	}
	return seat, true
}

func (h *healthHandler) ListCallKeyDevices(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	call, _, ok := loadCall(ctx, w, q, callId, session.AccountID, false)
	if !ok {
		return
	}
	if _, ok = seatOf(ctx, w, q, call, session.AccountID); !ok {
		return
	}
	seats, err := q.ListSeatDevices(ctx, call.ID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	devices := make([]gen.DirectoryDevice, 0, len(seats))
	for _, id := range seats {
		device, getErr := q.GetDevice(ctx, id)
		if getErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		email := ""
		if owner, ownerErr := q.GetAccountByID(ctx, device.AccountID); ownerErr == nil {
			email = owner.EmailNormalized
		}
		devices = append(devices, directoryEntry(device.ID, device.AccountID, email, device.Kind, device.State, device.SignPublicKey, device.BoxPublicKey, device.Certificate, device.AuthorizerDeviceID))
	}
	writeJSON(w, http.StatusOK, devices)
}

func (h *healthHandler) ListCallKeyEnvelopes(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	call, _, ok := loadCall(ctx, w, q, callId, session.AccountID, false)
	if !ok {
		return
	}
	seat, ok := seatOf(ctx, w, q, call, session.AccountID)
	if !ok {
		return
	}
	rows, err := q.ListCallKeyEnvelopes(ctx, sqlc.ListCallKeyEnvelopesParams{CallID: call.ID, RecipientDeviceID: seat.DeviceID})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	envelopes := make([]gen.KeyEnvelope, 0, len(rows))
	for _, row := range rows {
		envelopes = append(envelopes, gen.KeyEnvelope{
			Generation: int(row.Generation), RecipientDeviceId: fromPG(row.RecipientDeviceID), SignerDeviceId: fromPG(row.SignerDeviceID),
			Sealed: b64(row.Sealed), Signature: b64(row.Signature),
		})
	}
	writeJSON(w, http.StatusOK, envelopes)
}

// PublishCallKey stores the next ephemeral media key, sealed for exactly the
// devices that hold a seat right now. The server only checks who may receive
// it and who sealed it; it never sees the key. The recovery identity is not a
// recipient: calls are not recorded and not recoverable.
func (h *healthHandler) PublishCallKey(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.PublishGenerationRequest
	if !decodeJSONBodyLimit(w, r, &payload, 1<<20) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	call, rights, ok := loadCall(ctx, w, q, callId, session.AccountID, true)
	if !ok {
		return
	}
	if !rights.join {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if call.State != "active" {
		writeConflict(w, gen.CallEnded)
		return
	}
	seat, ok := seatOf(ctx, w, q, call, session.AccountID)
	if !ok {
		return
	}
	signer, err := q.GetDevice(ctx, pgUUID(uuidFrom(payload.SignerDeviceId)))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (signer.ID != seat.DeviceID || signer.State != "active")) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if int32(payload.Generation) != call.KeyGeneration+1 {
		w.WriteHeader(http.StatusConflict)
		return
	}
	seats, err := q.ListSeatDevices(ctx, call.ID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	given := make([]pgtype.UUID, 0, len(payload.Envelopes))
	for _, envelope := range payload.Envelopes {
		recipient := pgUUID(uuidFrom(envelope.RecipientDeviceId))
		if slices.Contains(given, recipient) || !slices.Contains(seats, recipient) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		given = append(given, recipient)
	}
	if len(given) != len(seats) {
		// Someone joined or left while the client was preparing the envelopes.
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err = q.InsertCallKeyGeneration(ctx, sqlc.InsertCallKeyGenerationParams{CallID: call.ID, Generation: int32(payload.Generation), CreatedByDevice: signer.ID}); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	for _, envelope := range payload.Envelopes {
		sealed, validSealed := unb64(envelope.Sealed, 0)
		signature, validSignature := unb64(envelope.Signature, ed25519.SignatureSize)
		recipient := pgUUID(uuidFrom(envelope.RecipientDeviceId))
		if !validSealed || !validSignature || len(sealed) < 48 || len(sealed) > maxSealedKeyBytes ||
			!keys.VerifyKeyEnvelope(signer.SignPublicKey, keys.KeyEnvelope{
				RecipientDeviceID: uuidString(recipient), DomainID: "call:" + uuidString(call.ID), Generation: uint32(payload.Generation), Sealed: sealed,
			}, signature) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if err = q.InsertCallKeyEnvelope(ctx, sqlc.InsertCallKeyEnvelopeParams{
			CallID: call.ID, Generation: int32(payload.Generation), RecipientDeviceID: recipient,
			SignerDeviceID: signer.ID, Sealed: sealed, Signature: signature,
		}); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
	}
	if err = q.AdvanceCallKey(ctx, sqlc.AdvanceCallKeyParams{ID: call.ID, KeyGeneration: int32(payload.Generation)}); err == nil {
		call.KeyGeneration = int32(payload.Generation)
		err = calls.Announce(ctx, q, call)
	}
	var response gen.Call
	if err == nil {
		response, err = buildCall(ctx, q, call, rights, session.AccountID)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, response)
}
