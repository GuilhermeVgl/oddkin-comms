package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/calls"
	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/livekit/protocol/livekit"
	"github.com/livekit/protocol/webhook"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

const callTokenTTL = 5 * time.Minute

var errMediaNotConfigured = errors.New("media server is not configured")

// callConflict ends a transaction with a 409 whose body says why the call
// cannot proceed; respondCallError writes it.
type callConflict gen.CallConflictCode

func (c callConflict) Error() string { return "call conflict: " + string(c) }

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
		serverError(w, nil, err)
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

func (h *callsAPI) mediaConfigured(w http.ResponseWriter, r *http.Request) bool {
	if h.auth == nil || h.auth.rooms == nil {
		serverError(w, r, errMediaNotConfigured)
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

func (h *callsAPI) StartCall(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !h.mediaConfigured(w, r) {
		return
	}
	var payload gen.StartCallRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	room, err := newRoomName()
	if err != nil {
		serverError(w, r, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	var (
		call   sqlc.Call
		rights callRights
	)
	err = h.inTx(ctx, func(q *sqlc.Queries) error {
		var err error
		if rights, err = callRightsTx(ctx, w, q, toPG(payload.ConversationId), session.AccountID); err != nil {
			return err
		}
		if !rights.start {
			return statusError(http.StatusForbidden)
		}
		if rights.archived {
			return statusError(http.StatusConflict)
		}
		eligible, err := eligibleInvitees(ctx, q, rights.conversation)
		if err != nil {
			return err
		}
		invitees, valid := chooseInvitees(payload.InviteeIds, eligible, session.AccountID, rights.conversation.Kind)
		if !valid {
			return statusError(http.StatusBadRequest)
		}
		call, err = createCall(ctx, q, rights.conversation, session.AccountID, room, invitees)
		return err
	})
	if respondError(w, r, err) {
		return
	}
	// Media-server effect after commit; on failure close the call again.
	if err = h.auth.rooms.CreateRoom(ctx, room, calls.MaxParticipants); err != nil {
		h.closeCall(ctx, call, "room_unavailable")
		serverError(w, r, err)
		return
	}
	reader := sqlc.New(h.auth.pool)
	response, err := buildCall(ctx, reader, call, rights, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

// closeCall ends a call in its own transaction (used after external failures).
func (h *callsAPI) closeCall(ctx context.Context, call sqlc.Call, reason string) {
	_ = h.inTx(ctx, func(q *sqlc.Queries) error {
		_, err := calls.End(ctx, q, call, reason)
		return err
	})
}

// loadCall resolves a call and the caller's rights, answering 404 otherwise.
func loadCall(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, id openapi_types.UUID, account pgtype.UUID, lock bool) (sqlc.Call, callRights, bool) {
	var (
		call sqlc.Call
		err  error
	)
	if lock {
		call, err = q.LockCall(ctx, toPG(id))
	} else {
		call, err = q.GetCall(ctx, toPG(id))
	}
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return call, callRights{}, false
	}
	if err != nil {
		serverError(w, nil, err)
		return call, callRights{}, false
	}
	rights, ok := resolveCallRights(ctx, w, q, call.ConversationID, account)
	return call, rights, ok
}

func (h *callsAPI) ticket(call sqlc.Call, session sqlc.FindActiveSessionByTokenHashRow, screenShare bool) (gen.CallTicket, error) {
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

func (h *callsAPI) JoinCall(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !h.mediaConfigured(w, r) {
		return
	}
	var payload gen.JoinCallRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	transfer := payload.Transfer != nil && *payload.Transfer
	deviceID := toPG(payload.DeviceId)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	var ticket gen.CallTicket
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		// The call row lock serializes concurrent admissions: the seat count and
		// the insert below are one atomic decision.
		call, rights, err := loadCallTx(ctx, w, q, callId, session.AccountID, true)
		if err != nil {
			return err
		}
		if !rights.join {
			return statusError(http.StatusForbidden)
		}
		if err = requireJoiningDevice(ctx, q, deviceID, session.AccountID); err != nil {
			return err
		}
		if call.State != "active" {
			return callConflict(gen.CallEnded)
		}
		invitation, err := lookupCallInvitation(ctx, q, call, session.AccountID)
		if err != nil {
			return err
		}
		if !invitation.invited {
			return statusError(http.StatusForbidden)
		}
		if err = q.ExpireStaleAdmissionsForAccount(ctx, session.AccountID); err != nil {
			return err
		}
		if err = q.ExpireStaleAdmissionsForCall(ctx, call.ID); err != nil {
			return err
		}
		if err = admitToCall(ctx, q, call, session, deviceID, transfer); err != nil {
			return err
		}
		if invitation.exists {
			if _, err = q.SetCallInvitationState(ctx, sqlc.SetCallInvitationStateParams{CallID: call.ID, AccountID: session.AccountID, State: "accepted"}); err != nil {
				return err
			}
		}
		if err = calls.Announce(ctx, q, call); err != nil {
			return err
		}
		ticket, err = h.ticket(call, session, call.ScreenSharerID == session.AccountID)
		return err
	})
	if respondCallError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, ticket)
}

func (h *callsAPI) DeclineCall(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		call, _, err := loadCallTx(ctx, w, q, callId, session.AccountID, true)
		if err != nil {
			return err
		}
		return setCallInvitationState(ctx, q, call, session.AccountID, "declined")
	})
	if respondError(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *callsAPI) CancelCallInvitation(w http.ResponseWriter, r *http.Request, callId gen.CallId, accountId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		call, _, err := loadCallTx(ctx, w, q, callId, session.AccountID, true)
		if err != nil {
			return err
		}
		if call.StartedBy != session.AccountID {
			return statusError(http.StatusForbidden)
		}
		return setCallInvitationState(ctx, q, call, toPG(accountId), "cancelled")
	})
	if respondError(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *callsAPI) LeaveCall(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	var (
		call  sqlc.Call
		ended bool
	)
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		var err error
		if call, _, err = loadCallTx(ctx, w, q, callId, session.AccountID, true); err != nil {
			return err
		}
		if call.State == "active" {
			ended, err = calls.ParticipantLeft(ctx, q, call, session.AccountID)
		}
		return err
	})
	if respondError(w, r, err) {
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

func (h *callsAPI) EndCall(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	var (
		call  sqlc.Call
		ended bool
	)
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		var (
			rights callRights
			err    error
		)
		if call, rights, err = loadCallTx(ctx, w, q, callId, session.AccountID, true); err != nil {
			return err
		}
		// The initiator or, in a channel, a project manager may end the call. In a
		// DM the other person leaves instead.
		if call.StartedBy != session.AccountID && (rights.conversation.Kind != "channel" || !rights.manager) {
			return statusError(http.StatusForbidden)
		}
		ended, err = calls.End(ctx, q, call, "ended")
		return err
	})
	if respondError(w, r, err) {
		return
	}
	if ended && h.auth.rooms != nil {
		_ = h.auth.rooms.DeleteRoom(ctx, call.RoomName)
	}
	w.WriteHeader(http.StatusNoContent)
}

// LivekitWebhook verifies the signature, ignores replays and reconciles presence.
func (h *callsAPI) LivekitWebhook(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil || h.auth.rooms == nil {
		serverError(w, r, errMediaNotConfigured)
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
	var effects webhookEffects
	err = h.inTx(ctx, func(q *sqlc.Queries) error {
		var err error
		effects, err = reconcileWebhook(ctx, q, event)
		return err
	})
	if respondError(w, r, err) {
		return
	}
	if effects.kick {
		_ = h.auth.rooms.Remove(ctx, effects.roomName, effects.identity)
	}
	if effects.deleteRoom {
		_ = h.auth.rooms.DeleteRoom(ctx, effects.roomName)
	}
	w.WriteHeader(http.StatusNoContent)
}

// seatOf returns the caller's seat in this call, answering 403 otherwise.
func seatOf(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, call sqlc.Call, account pgtype.UUID) (sqlc.CallAdmission, bool) {
	if err := q.ExpireStaleAdmissionsForCall(ctx, call.ID); err != nil {
		serverError(w, nil, err)
		return sqlc.CallAdmission{}, false
	}
	seat, err := q.ActiveAdmissionForAccount(ctx, account)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (seat.CallID != call.ID || !seat.DeviceID.Valid)) {
		w.WriteHeader(http.StatusForbidden)
		return seat, false
	}
	if err != nil {
		serverError(w, nil, err)
		return seat, false
	}
	return seat, true
}

// respondCallError is respondError for call handlers: a callConflict becomes
// the 409 body clients use to tell why the call cannot proceed.
func respondCallError(w http.ResponseWriter, r *http.Request, err error) bool {
	var conflict callConflict
	if errors.As(err, &conflict) {
		writeConflict(w, gen.CallConflictCode(conflict))
		return true
	}
	return respondError(w, r, err)
}

// callRightsTx is resolveCallRights for use inside inTx: when it has already
// answered (404 and the like) it returns errResponded.
func callRightsTx(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, conversationID, accountID pgtype.UUID) (callRights, error) {
	rights, ok := resolveCallRights(ctx, w, q, conversationID, accountID)
	if !ok {
		return rights, errResponded
	}
	return rights, nil
}

// loadCallTx is loadCall for use inside inTx.
func loadCallTx(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, id openapi_types.UUID, account pgtype.UUID, lock bool) (sqlc.Call, callRights, error) {
	call, rights, ok := loadCall(ctx, w, q, id, account, lock)
	if !ok {
		return call, rights, errResponded
	}
	return call, rights, nil
}

// seatTx is seatOf for use inside inTx.
func seatTx(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, call sqlc.Call, account pgtype.UUID) (sqlc.CallAdmission, error) {
	seat, ok := seatOf(ctx, w, q, call, account)
	if !ok {
		return seat, errResponded
	}
	return seat, nil
}

// chooseInvitees validates who a call should ring. Every requested person must
// be eligible, not the caller and listed once. A DM with no explicit list rings
// the other person. It reports false for an invalid request.
func chooseInvitees(requested *[]openapi_types.UUID, eligible []pgtype.UUID, self pgtype.UUID, conversationKind string) ([]pgtype.UUID, bool) {
	var invitees []pgtype.UUID
	if requested != nil {
		for _, id := range *requested {
			invitee := toPG(id)
			if invitee == self || !slices.Contains(eligible, invitee) || slices.Contains(invitees, invitee) {
				return nil, false
			}
			invitees = append(invitees, invitee)
		}
	}
	if conversationKind == "dm" && len(invitees) == 0 {
		for _, id := range eligible {
			if id != self {
				invitees = append(invitees, id)
			}
		}
	}
	return invitees, true
}

// createCall opens the call and, in the same transaction, invites, notifies and
// announces it. A conversation can have one active call, so a second is a 409.
func createCall(ctx context.Context, q *sqlc.Queries, conversation sqlc.Conversation, starter pgtype.UUID, room string, invitees []pgtype.UUID) (sqlc.Call, error) {
	call, err := q.CreateCall(ctx, sqlc.CreateCallParams{ConversationID: conversation.ID, StartedBy: starter, RoomName: room})
	if isUniqueViolation(err) {
		return call, statusError(http.StatusConflict)
	}
	if err != nil {
		return call, err
	}
	for _, invitee := range invitees {
		if err = q.UpsertCallInvitation(ctx, sqlc.UpsertCallInvitationParams{CallID: call.ID, AccountID: invitee}); err != nil {
			return call, err
		}
		if err = notifyAccount(ctx, q, invitee, "call_invite", call.ID, conversation.ProjectID, conversation.ID); err != nil {
			return call, err
		}
	}
	if len(invitees) > 0 {
		err = emitEvent(ctx, q, invitees, eventSpec{Type: "call.invited", ResourceID: call.ID, ProjectID: conversation.ProjectID, ConversationID: conversation.ID})
		if err != nil {
			return call, err
		}
	}
	return call, calls.Announce(ctx, q, call)
}

// requireJoiningDevice checks the device the caller wants to join with. Media
// is end-to-end encrypted: a seat needs an active device of the caller to seal
// the call key for. There is no unencrypted way in.
func requireJoiningDevice(ctx context.Context, q *sqlc.Queries, deviceID, account pgtype.UUID) error {
	device, err := q.GetDevice(ctx, deviceID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (device.AccountID != account || device.State != "active" || device.Kind != "device")) {
		return statusError(http.StatusBadRequest)
	}
	return err
}

// callInvitation is what the account's invitation row says about joining.
type callInvitation struct {
	exists  bool // a row exists, so joining must mark it accepted
	invited bool // the account started the call or holds a live invitation
}

// lookupCallInvitation reads the account's standing in a call it wants to join.
func lookupCallInvitation(ctx context.Context, q *sqlc.Queries, call sqlc.Call, account pgtype.UUID) (callInvitation, error) {
	result := callInvitation{invited: call.StartedBy == account}
	row, err := q.GetCallInvitation(ctx, sqlc.GetCallInvitationParams{CallID: call.ID, AccountID: account})
	switch {
	case err == nil:
		result.exists = true
		if row.State == "pending" || row.State == "accepted" {
			result.invited = true
		}
	case !errors.Is(err, pgx.ErrNoRows):
		return result, err
	}
	return result, nil
}

// admitToCall gives the session a seat: renews it on a reconnect, takes it over
// for another device when asked to, or counts the seats against the limit. The
// caller holds the call row lock.
func admitToCall(ctx context.Context, q *sqlc.Queries, call sqlc.Call, session sqlc.FindActiveSessionByTokenHashRow, deviceID pgtype.UUID, transfer bool) error {
	existing, err := q.ActiveAdmissionForAccount(ctx, session.AccountID)
	switch {
	case err == nil && existing.CallID != call.ID:
		return callConflict(gen.InOtherCall)
	case err == nil:
		// Same call: a reconnect of this session renews the seat; another
		// device must ask to take it over explicitly.
		if existing.SessionID != session.ID && !transfer {
			return callConflict(gen.OtherDevice)
		}
		_, err = q.RenewAdmission(ctx, sqlc.RenewAdmissionParams{ID: existing.ID, SessionID: session.ID, DeviceID: deviceID, Seconds: float64(calls.ReservationSeconds)})
	case errors.Is(err, pgx.ErrNoRows):
		seats, countErr := q.CountCallSeats(ctx, call.ID)
		if countErr != nil {
			return countErr
		}
		if seats >= calls.MaxParticipants {
			return callConflict(gen.CallFull)
		}
		_, err = q.InsertAdmission(ctx, sqlc.InsertAdmissionParams{CallID: call.ID, AccountID: session.AccountID, SessionID: session.ID, DeviceID: deviceID, Seconds: float64(calls.ReservationSeconds)})
	}
	if isUniqueViolation(err) {
		return callConflict(gen.InOtherCall)
	}
	return err
}

// setCallInvitationState moves an invitation to a new state and announces it.
// Someone who was never invited gets a 404.
func setCallInvitationState(ctx context.Context, q *sqlc.Queries, call sqlc.Call, account pgtype.UUID, state string) error {
	changed, err := q.SetCallInvitationState(ctx, sqlc.SetCallInvitationStateParams{CallID: call.ID, AccountID: account, State: state})
	if err != nil {
		return err
	}
	if changed == 0 {
		return statusError(http.StatusNotFound)
	}
	return calls.Announce(ctx, q, call)
}

// acquireScreenShare takes the call's single screen-share slot for an account
// that holds a seat in it. The caller holds the call row lock.
func acquireScreenShare(ctx context.Context, q *sqlc.Queries, call sqlc.Call, account pgtype.UUID) error {
	seat, err := q.ActiveAdmissionForAccount(ctx, account)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && seat.CallID != call.ID) {
		return callConflict(gen.NotInCall)
	}
	if err != nil {
		return err
	}
	taken, err := q.AcquireScreenShare(ctx, sqlc.AcquireScreenShareParams{ID: call.ID, ScreenSharerID: account})
	if err != nil {
		return err
	}
	if taken == 0 {
		return callConflict(gen.ScreenShareTaken)
	}
	return nil
}

// webhookEffects are the media-server actions a webhook calls for once its
// database changes have committed.
type webhookEffects struct {
	roomName, identity string
	kick, deleteRoom   bool
}

// reconcileWebhook applies one LiveKit event to the database. An event that is
// a replay or names no known call ends in statusError(204): the transaction
// rolls back and LiveKit is told the event was handled.
func reconcileWebhook(ctx context.Context, q *sqlc.Queries, event *livekit.WebhookEvent) (webhookEffects, error) {
	effects := webhookEffects{roomName: event.GetRoom().GetName(), identity: event.GetParticipant().GetIdentity()}
	if event.GetId() != "" {
		fresh, err := q.RecordWebhookEvent(ctx, event.GetId())
		if err != nil {
			return effects, err
		}
		if fresh == 0 {
			return effects, statusError(http.StatusNoContent)
		}
	}
	call, err := q.GetCallByRoom(ctx, effects.roomName)
	if errors.Is(err, pgx.ErrNoRows) {
		return effects, statusError(http.StatusNoContent)
	}
	if err == nil {
		call, err = q.LockCall(ctx, call.ID)
	}
	if err != nil {
		return effects, err
	}
	account, parseErr := uuid.Parse(effects.identity)
	switch event.GetEvent() {
	case "participant_joined":
		if parseErr != nil {
			effects.kick = true
		} else {
			effects.kick, err = calls.ParticipantJoined(ctx, q, call, pgUUID(account))
		}
	case "participant_left":
		if parseErr == nil && call.State == "active" {
			effects.deleteRoom, err = calls.ParticipantLeft(ctx, q, call, pgUUID(account))
		}
	case "room_finished":
		_, err = calls.End(ctx, q, call, "room_finished")
	}
	return effects, err
}

// storeCallKey records the next key generation of a call and its envelopes,
// refusing (400) any envelope whose signer, recipient or size does not check
// out, then moves the call to the new generation.
func storeCallKey(ctx context.Context, q *sqlc.Queries, call sqlc.Call, signer sqlc.Device, generation int, items []grantItem) error {
	if err := q.InsertCallKeyGeneration(ctx, sqlc.InsertCallKeyGenerationParams{CallID: call.ID, Generation: int32(generation), CreatedByDevice: signer.ID}); err != nil {
		return err
	}
	domainID := "call:" + uuidString(call.ID)
	for _, item := range items {
		sealed, signature, valid := openKeyEnvelope(signer.SignPublicKey, domainID, item, generation)
		if !valid {
			return statusError(http.StatusBadRequest)
		}
		if err := q.InsertCallKeyEnvelope(ctx, sqlc.InsertCallKeyEnvelopeParams{
			CallID: call.ID, Generation: int32(generation), RecipientDeviceID: item.recipient,
			SignerDeviceID: signer.ID, Sealed: sealed, Signature: signature,
		}); err != nil {
			return err
		}
	}
	return q.AdvanceCallKey(ctx, sqlc.AdvanceCallKeyParams{ID: call.ID, KeyGeneration: int32(generation)})
}
