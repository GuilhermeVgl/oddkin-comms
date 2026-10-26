package httpapi

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/calls"
	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

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

func (h *apiServer) ListCallKeyDevices(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
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
		serverError(w, r, err)
		return
	}
	devices := make([]gen.DirectoryDevice, 0, len(seats))
	for _, id := range seats {
		device, getErr := q.GetDevice(ctx, id)
		if getErr != nil {
			serverError(w, r, getErr)
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

func (h *apiServer) ListCallKeyEnvelopes(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
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
		serverError(w, r, err)
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
func (h *apiServer) PublishCallKey(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
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
	var response gen.Call
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		call, rights, err := loadCallTx(ctx, w, q, callId, session.AccountID, true)
		if err != nil {
			return err
		}
		if !rights.join {
			return statusError(http.StatusForbidden)
		}
		if call.State != "active" {
			return callConflict(gen.CallEnded)
		}
		seat, err := seatTx(ctx, w, q, call, session.AccountID)
		if err != nil {
			return err
		}
		signer, err := q.GetDevice(ctx, toPG(payload.SignerDeviceId))
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (signer.ID != seat.DeviceID || signer.State != "active")) {
			return statusError(http.StatusForbidden)
		}
		if err != nil {
			return err
		}
		if int32(payload.Generation) != call.KeyGeneration+1 {
			return statusError(http.StatusConflict)
		}
		seats, err := q.ListSeatDevices(ctx, call.ID)
		if err != nil {
			return err
		}
		items := toGrantItems(payload.Envelopes)
		if err = checkEnvelopeRecipients(items, seats); err != nil {
			return err
		}
		if err = storeCallKey(ctx, q, call, signer, payload.Generation, items); err != nil {
			return err
		}
		call.KeyGeneration = int32(payload.Generation)
		if err = calls.Announce(ctx, q, call); err != nil {
			return err
		}
		response, err = buildCall(ctx, q, call, rights, session.AccountID)
		return err
	})
	if respondCallError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, response)
}
