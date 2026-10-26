package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/jobs"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func (h *healthHandler) CreateInvitation(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	session, status := h.activeSession(r)
	if status != http.StatusOK {
		w.WriteHeader(status)
		return
	}
	if !identity.VerifyCSRFToken(r.Header.Get("X-CSRF-Token"), session.CsrfHash) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if len(h.auth.invitationDeliveryKey) != identity.InvitationDeliveryKeySize {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	var payload gen.CreateInvitationRequest
	if !decodeInvitationRequest(w, r, &payload) {
		return
	}
	email, err := identity.NormalizeEmail(string(payload.Email))
	if err != nil || !payload.MembershipKind.Valid() {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	membership, err := sqlc.New(h.auth.pool).GetOrganizationMembershipForAccount(ctx, session.AccountID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (!membership.IsAdmin || membership.MembershipKind != "internal")) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	token, record, err := identity.IssueInvitationToken(time.Now())
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	sealedToken, err := identity.SealInvitationToken(h.auth.invitationDeliveryKey, token)
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
	queries := sqlc.New(tx)
	if _, err = queries.RevokePendingOrganizationInvitations(ctx, sqlc.RevokePendingOrganizationInvitationsParams{
		OrganizationID: membership.OrganizationID, EmailNormalized: email,
	}); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	created, err := queries.CreateOrganizationInvitation(ctx, sqlc.CreateOrganizationInvitationParams{
		OrganizationID: membership.OrganizationID, EmailNormalized: email,
		MembershipKind: string(payload.MembershipKind), TokenHash: record.Hash[:],
		ExpiresAt: pgtype.Timestamptz{Time: record.ExpiresAt, Valid: true},
	})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if err = queries.SetInvitationRequester(ctx, sqlc.SetInvitationRequesterParams{ID: created.ID, RequestedBy: session.AccountID}); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if err = queries.CreateInvitationDelivery(ctx, sqlc.CreateInvitationDeliveryParams{InvitationID: created.ID, TokenCiphertext: sealedToken}); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	invitationID := uuid.UUID(created.ID.Bytes)
	if _, err = h.auth.jobs.InsertTx(ctx, tx, jobs.InvitationEmailArgs{InvitationID: invitationID.String()}, nil); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	response := gen.Invitation{
		Id: openapi_types.UUID(invitationID), Email: openapi_types.Email(email),
		MembershipKind: gen.InvitationMembershipKind(payload.MembershipKind),
		ExpiresAt:      record.ExpiresAt, DeliveryState: gen.InvitationDeliveryStatePending,
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(response)
}

func (h *healthHandler) AcceptInvitation(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if !sameOrigin(r) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var payload gen.AcceptInvitationRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	email, err := identity.NormalizeEmail(string(payload.Email))
	hash, validToken := identity.HashInvitationToken(payload.Token)
	if err != nil || !validToken {
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
	queries := sqlc.New(tx)
	invitation, err := queries.ClaimOrganizationInvitation(ctx, sqlc.ClaimOrganizationInvitationParams{
		TokenHash: hash[:], EmailNormalized: email,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	account, err := queries.GetAccountByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		if payload.Password == nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		passwordHash, hashErr := identity.HashPassword(*payload.Password)
		if hashErr != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		account, err = queries.CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: email, PasswordHash: passwordHash})
	} else if err == nil {
		session, sessionStatus := h.activeSession(r)
		if sessionStatus != http.StatusOK || session.EmailNormalized != email || !account.Active {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if _, err = queries.EnsureOrganizationMembership(ctx, sqlc.EnsureOrganizationMembershipParams{
		OrganizationID: invitation.OrganizationID, AccountID: account.ID, MembershipKind: invitation.MembershipKind,
	}); errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusBadRequest)
		return
	} else if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if err = queries.ClearInvitationDeliveryToken(ctx, invitation.ID); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func decodeInvitationRequest(w http.ResponseWriter, r *http.Request, payload *gen.CreateInvitationRequest) bool {
	return decodeJSONBody(w, r, payload)
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, payload any) bool {
	return decodeJSONBodyLimit(w, r, payload, 4096)
}

func decodeJSONBodyLimit(w http.ResponseWriter, r *http.Request, payload any, limit int64) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		w.WriteHeader(http.StatusBadRequest)
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		w.WriteHeader(http.StatusBadRequest)
		return false
	}
	return true
}
