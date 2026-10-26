package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/calls"
	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/google/uuid"
)

func (h *apiServer) StartScreenShare(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !h.mediaConfigured(w, r) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var (
		call   sqlc.Call
		ticket gen.CallTicket
	)
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		var (
			rights callRights
			err    error
		)
		if call, rights, err = loadCallTx(ctx, w, q, callId, session.AccountID, true); err != nil {
			return err
		}
		if !rights.screen {
			return statusError(http.StatusForbidden)
		}
		if call.State != "active" {
			return callConflict(gen.CallEnded)
		}
		if err = acquireScreenShare(ctx, q, call, session.AccountID); err != nil {
			return err
		}
		if err = calls.Announce(ctx, q, call); err != nil {
			return err
		}
		ticket, err = h.ticket(call, session, true)
		return err
	})
	if respondCallError(w, r, err) {
		return
	}
	// The slot is ours; now let LiveKit accept the screen from this person,
	// outside any database lock. If it cannot, give the slot back.
	if grantErr := h.auth.rooms.SetScreenShare(ctx, call.RoomName, uuid.UUID(session.AccountID.Bytes).String(), true); grantErr != nil {
		slog.Warn("screen share permission was not granted", "error", grantErr)
		_ = sqlc.New(h.auth.pool).ReleaseScreenShare(ctx, sqlc.ReleaseScreenShareParams{ID: call.ID, ScreenSharerID: session.AccountID})
		serverError(w, r, grantErr)
		return
	}
	writeJSON(w, http.StatusOK, ticket)
}

func (h *apiServer) StopScreenShare(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var call sqlc.Call
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		var err error
		if call, _, err = loadCallTx(ctx, w, q, callId, session.AccountID, true); err != nil {
			return err
		}
		if err = q.ReleaseScreenShare(ctx, sqlc.ReleaseScreenShareParams{ID: call.ID, ScreenSharerID: session.AccountID}); err != nil {
			return err
		}
		return calls.Announce(ctx, q, call)
	})
	if respondError(w, r, err) {
		return
	}
	if h.auth.rooms != nil {
		_ = h.auth.rooms.SetScreenShare(ctx, call.RoomName, uuid.UUID(session.AccountID.Bytes).String(), false)
	}
	w.WriteHeader(http.StatusNoContent)
}
