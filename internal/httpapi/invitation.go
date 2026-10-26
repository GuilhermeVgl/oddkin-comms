package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
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

// linkExtraPattern keeps the inviter-chosen fragment to plain parameters.
var linkExtraPattern = regexp.MustCompile(`^[A-Za-z0-9_=&.-]{1,300}$`)

func (h *apiServer) CreateInvitation(w http.ResponseWriter, r *http.Request) {
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
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	orgAdmin := membership.IsAdmin && membership.MembershipKind == "internal"

	var projectID pgtype.UUID
	if payload.ProjectId != nil {
		q := sqlc.New(h.auth.pool)
		project, projectErr := q.GetProject(ctx, toPG(*payload.ProjectId))
		if errors.Is(projectErr, pgx.ErrNoRows) || (projectErr == nil && project.OrganizationID != membership.OrganizationID) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if projectErr != nil {
			serverError(w, r, projectErr)
			return
		}
		if !orgAdmin {
			access, found, accessErr := lookupAccess(ctx, q, project.ID, session.AccountID)
			if accessErr != nil {
				serverError(w, r, accessErr)
				return
			}
			if !found || !mayBringPeopleIn(project.InvitePolicy, access.access, false) {
				w.WriteHeader(http.StatusForbidden)
				return
			}
		}
		if project.Archived {
			w.WriteHeader(http.StatusConflict)
			return
		}
		projectID = project.ID
	}
	if !orgAdmin {
		// Outside the administration an invitation always belongs to a project the
		// inviter may open, brings an external person, and cannot carry history
		// (only the administrator's browser can vouch for that).
		if !projectID.Valid || payload.MembershipKind != gen.CreateInvitationRequestMembershipKindExternal {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if payload.HistoryMode != nil && *payload.HistoryMode == gen.Auto {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
	}
	historyMode := "ask"
	if payload.HistoryMode != nil {
		historyMode = string(*payload.HistoryMode)
	}
	if !gen.HistoryMode(historyMode).Valid() {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	var sealedExtra []byte
	if payload.LinkExtra != nil && *payload.LinkExtra != "" {
		if historyMode != "auto" || !linkExtraPattern.MatchString(*payload.LinkExtra) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		sealed, sealErr := identity.SealInvitationToken(h.auth.invitationDeliveryKey, *payload.LinkExtra)
		if sealErr != nil {
			serverError(w, r, sealErr)
			return
		}
		sealedExtra = sealed
	}
	token, record, err := identity.IssueInvitationToken(time.Now())
	if err != nil {
		serverError(w, r, err)
		return
	}
	sealedToken, err := identity.SealInvitationToken(h.auth.invitationDeliveryKey, token)
	if err != nil {
		serverError(w, r, err)
		return
	}
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		serverError(w, r, err)
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
		ExpiresAt: pgtype.Timestamptz{Time: record.ExpiresAt, Valid: true}, HistoryMode: historyMode, ProjectID: projectID,
	})
	if err != nil {
		serverError(w, r, err)
		return
	}
	if err = queries.SetInvitationRequester(ctx, sqlc.SetInvitationRequesterParams{ID: created.ID, RequestedBy: session.AccountID}); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if err = queries.CreateInvitationDelivery(ctx, sqlc.CreateInvitationDeliveryParams{InvitationID: created.ID, TokenCiphertext: sealedToken, ExtraCiphertext: sealedExtra}); err != nil {
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
		HistoryMode: func() *gen.HistoryMode { mode := gen.HistoryMode(historyMode); return &mode }(),
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(response)
}

func (h *apiServer) AcceptInvitation(w http.ResponseWriter, r *http.Request) {
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
		serverError(w, r, err)
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
		serverError(w, r, err)
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
		serverError(w, r, err)
		return
	}
	if _, err = queries.EnsureOrganizationMembership(ctx, sqlc.EnsureOrganizationMembershipParams{
		OrganizationID: invitation.OrganizationID, AccountID: account.ID, MembershipKind: invitation.MembershipKind,
		HistoryMode: invitation.HistoryMode,
	}); errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusBadRequest)
		return
	} else if err != nil {
		serverError(w, r, err)
		return
	}
	if invitation.ProjectID.Valid {
		// Invited from a project: the person lands in it, and the key domains learn about them.
		err = queries.AddProjectMember(ctx, sqlc.AddProjectMemberParams{ProjectID: invitation.ProjectID, AccountID: account.ID, IsManager: false})
		if err == nil {
			err = refreshProjectDomains(ctx, queries, invitation.ProjectID)
		}
		if err == nil {
			err = announceProjectChanged(ctx, queries, invitation.ProjectID)
		}
		if err != nil {
			serverError(w, r, err)
			return
		}
	}
	// Whoever invited is told that the person arrived, and open admin screens refresh.
	if invitation.RequestedBy.Valid {
		err = notifyAccount(ctx, queries, invitation.RequestedBy, "invitation_accepted", invitation.ID, pgtype.UUID{}, pgtype.UUID{})
	}
	if err == nil {
		var admins []pgtype.UUID
		if admins, err = queries.ListOrganizationAdmins(ctx, invitation.OrganizationID); err == nil {
			err = emitEvent(ctx, queries, admins, eventSpec{Type: "invitation.changed", ResourceID: invitation.ID})
		}
	}
	if err != nil {
		serverError(w, r, err)
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

// ListInvitations tells administrators which invitations are still waiting and
// which were accepted.
func (h *apiServer) ListInvitations(w http.ResponseWriter, r *http.Request, params gen.ListInvitationsParams) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	membership, err := q.GetOrganizationMembershipForAccount(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	type invitationRow struct {
		ID, ProjectID                      pgtype.UUID
		Email, Kind, HistoryMode, Delivery string
		ExpiresAt, CreatedAt               time.Time
		ConsumedAt                         pgtype.Timestamptz
	}
	var rows []invitationRow
	switch {
	case params.ProjectId != nil:
		projectID := toPG(*params.ProjectId)
		if !session.IsAdmin {
			access, found, accessErr := lookupAccess(ctx, q, projectID, session.AccountID)
			if accessErr != nil {
				serverError(w, r, accessErr)
				return
			}
			if !found || !access.access.Manager {
				w.WriteHeader(http.StatusForbidden)
				return
			}
		}
		list, listErr := q.ListProjectInvitations(ctx, projectID)
		if listErr != nil {
			serverError(w, r, listErr)
			return
		}
		for _, row := range list {
			rows = append(rows, invitationRow{row.ID, row.ProjectID, row.EmailNormalized, row.MembershipKind, row.HistoryMode, row.DeliveryState, row.ExpiresAt.Time, row.CreatedAt.Time, row.ConsumedAt})
		}
	case session.IsAdmin:
		list, listErr := q.ListOrganizationInvitations(ctx, membership.OrganizationID)
		if listErr != nil {
			serverError(w, r, listErr)
			return
		}
		for _, row := range list {
			rows = append(rows, invitationRow{row.ID, row.ProjectID, row.EmailNormalized, row.MembershipKind, row.HistoryMode, row.DeliveryState, row.ExpiresAt.Time, row.CreatedAt.Time, row.ConsumedAt})
		}
	default:
		w.WriteHeader(http.StatusForbidden)
		return
	}
	now := time.Now()
	list := make([]gen.InvitationStatus, 0, len(rows))
	for _, row := range rows {
		state := gen.InvitationStatusStatePending
		switch {
		case row.ConsumedAt.Valid:
			state = gen.InvitationStatusStateAccepted
		case row.ExpiresAt.Before(now):
			state = gen.InvitationStatusStateExpired
		case row.Delivery == "failed":
			state = gen.InvitationStatusStateFailed
		}
		entry := gen.InvitationStatus{
			Id: fromPG(row.ID), Email: openapi_types.Email(row.Email), State: state,
			MembershipKind: gen.InvitationStatusMembershipKind(row.Kind), HistoryMode: gen.HistoryMode(row.HistoryMode),
			ExpiresAt: row.ExpiresAt, CreatedAt: row.CreatedAt,
		}
		if row.ProjectID.Valid {
			project := fromPG(row.ProjectID)
			entry.ProjectId = &project
		}
		if row.ConsumedAt.Valid {
			accepted := row.ConsumedAt.Time
			entry.AcceptedAt = &accepted
		}
		list = append(list, entry)
	}
	writeJSON(w, http.StatusOK, list)
}
