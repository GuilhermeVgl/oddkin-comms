package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/oddkin-comms/internal/identity"
	"github.com/GuilhermeVgl/oddkin-comms/internal/jobs"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// RequestPasswordReset always answers 202, so nobody learns which e-mails have
// an account. When one does, the link is sent by a job created in the same
// transaction that stores the token's hash.
func (h *healthHandler) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if !sameOrigin(r) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var payload gen.PasswordResetRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	email, err := identity.NormalizeEmail(string(payload.Email))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	now := time.Now()
	ip := clientAddress(r.RemoteAddr)
	key := "reset:" + email
	if !h.auth.limiter.allow("reset-ip:"+ip, 20, now) || !h.auth.limiter.allow(key, 3, now) {
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	// Every request counts, whether or not the account exists.
	h.auth.limiter.fail("reset-ip:"+ip, 20, now)
	h.auth.limiter.fail(key, 3, now)
	if len(h.auth.invitationDeliveryKey) != identity.InvitationDeliveryKeySize || h.auth.jobs == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	account, err := sqlc.New(h.auth.pool).GetAccountByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !account.Active) {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	token, hash, expiresAt, err := identity.IssueResetToken(now)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	sealed, err := identity.SealResetToken(h.auth.invitationDeliveryKey, token)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	if err = q.RevokePendingPasswordResets(ctx, account.ID); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	resetID, err := q.CreatePasswordReset(ctx, sqlc.CreatePasswordResetParams{
		AccountID: account.ID, TokenHash: hash[:], TokenCiphertext: sealed,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err == nil {
		_, err = h.auth.jobs.InsertTx(ctx, tx, jobs.PasswordResetEmailArgs{ResetID: uuid.UUID(resetID.Bytes).String()}, nil)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// ConfirmPasswordReset spends the token, sets the password and ends every
// earlier session. It touches no encryption key: the history stays unreadable
// until this device is authorised again.
func (h *healthHandler) ConfirmPasswordReset(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if !sameOrigin(r) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var payload gen.PasswordResetConfirmRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	now := time.Now()
	ip := "reset-confirm:" + clientAddress(r.RemoteAddr)
	if !h.auth.limiter.allow(ip, 10, now) {
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	hash, valid := identity.HashResetToken(payload.Token)
	if !valid {
		h.auth.limiter.fail(ip, 10, now)
		w.WriteHeader(http.StatusNotFound)
		return
	}
	passwordHash, err := identity.HashPassword(payload.Password)
	if err != nil {
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
	accountID, err := q.ClaimPasswordReset(ctx, hash[:])
	if errors.Is(err, pgx.ErrNoRows) {
		h.auth.limiter.fail(ip, 10, now)
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err == nil {
		err = q.SetAccountPassword(ctx, sqlc.SetAccountPasswordParams{ID: accountID, PasswordHash: passwordHash})
	}
	if err == nil {
		_, err = q.RevokeAllAccountSessions(ctx, accountID)
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
