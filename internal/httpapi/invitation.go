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

var errInvitationDeliveryNotConfigured = errors.New("invitation delivery key is not configured")

func (h *identityAPI) CreateInvitation(w http.ResponseWriter, r *http.Request) {
	session, ok := h.invitationInviter(w, r)
	if !ok {
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

	projectID, err := h.invitationProject(ctx, session.AccountID, membership.OrganizationID, orgAdmin, payload.ProjectId)
	if respondError(w, r, err) {
		return
	}
	historyMode, err := planInvitation(orgAdmin, projectID.Valid, payload)
	if respondError(w, r, err) {
		return
	}
	var sealedExtra []byte
	if payload.LinkExtra != nil && *payload.LinkExtra != "" {
		if sealedExtra, err = identity.SealInvitationToken(h.auth.invitationDeliveryKey, *payload.LinkExtra); err != nil {
			serverError(w, r, err)
			return
		}
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

	var invitationID uuid.UUID
	err = h.inTxPgx(ctx, func(tx pgx.Tx, q *sqlc.Queries) error {
		var storeErr error
		invitationID, storeErr = h.storeInvitation(ctx, tx, q, invitationDraft{
			organizationID: membership.OrganizationID, projectID: projectID, requestedBy: session.AccountID,
			email: email, kind: string(payload.MembershipKind), historyMode: historyMode,
			tokenHash: record.Hash[:], expiresAt: record.ExpiresAt, sealedToken: sealedToken, sealedExtra: sealedExtra,
		})
		return storeErr
	})
	if respondError(w, r, err) {
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

// invitationInviter authenticates the person creating an invitation: same
// origin, an active session, a valid CSRF token and a configured delivery key.
func (h *identityAPI) invitationInviter(w http.ResponseWriter, r *http.Request) (sqlc.FindActiveSessionByTokenHashRow, bool) {
	if !sameOrigin(r) {
		w.WriteHeader(http.StatusForbidden)
		return sqlc.FindActiveSessionByTokenHashRow{}, false
	}
	session, status := h.activeSession(r)
	if status != http.StatusOK {
		w.WriteHeader(status)
		return session, false
	}
	if !identity.VerifyCSRFToken(r.Header.Get("X-CSRF-Token"), session.CsrfHash) {
		w.WriteHeader(http.StatusForbidden)
		return session, false
	}
	if len(h.auth.invitationDeliveryKey) != identity.InvitationDeliveryKeySize {
		serverError(w, r, errInvitationDeliveryNotConfigured)
		return session, false
	}
	return session, true
}

// invitationProject resolves the project an invitation belongs to, if any, and
// checks that the inviter may bring people into it.
func (h *identityAPI) invitationProject(ctx context.Context, inviter, organizationID pgtype.UUID, orgAdmin bool, requested *openapi_types.UUID) (pgtype.UUID, error) {
	if requested == nil {
		return pgtype.UUID{}, nil
	}
	q := sqlc.New(h.auth.pool)
	project, err := q.GetProject(ctx, toPG(*requested))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && project.OrganizationID != organizationID) {
		return pgtype.UUID{}, statusError(http.StatusBadRequest)
	}
	if err != nil {
		return pgtype.UUID{}, err
	}
	if !orgAdmin {
		access, found, accessErr := lookupAccess(ctx, q, project.ID, inviter)
		if accessErr != nil {
			return pgtype.UUID{}, accessErr
		}
		if !found || !mayBringPeopleIn(project.InvitePolicy, access.access, false) {
			return pgtype.UUID{}, statusError(http.StatusForbidden)
		}
	}
	if project.Archived {
		return pgtype.UUID{}, statusError(http.StatusConflict)
	}
	return project.ID, nil
}

// planInvitation applies the rules on who may invite whom and how, and returns
// the history mode to store. It touches no state, so it answers with a
// statusError.
func planInvitation(orgAdmin, inProject bool, payload gen.CreateInvitationRequest) (string, error) {
	if !orgAdmin {
		// Outside the administration an invitation always belongs to a project the
		// inviter may open, brings an external person, and cannot carry history
		// (only the administrator's browser can vouch for that).
		if !inProject || payload.MembershipKind != gen.CreateInvitationRequestMembershipKindExternal {
			return "", statusError(http.StatusForbidden)
		}
		if payload.HistoryMode != nil && *payload.HistoryMode == gen.Auto {
			return "", statusError(http.StatusBadRequest)
		}
	}
	historyMode := "ask"
	if payload.HistoryMode != nil {
		historyMode = string(*payload.HistoryMode)
	}
	if !gen.HistoryMode(historyMode).Valid() {
		return "", statusError(http.StatusBadRequest)
	}
	if payload.LinkExtra != nil && *payload.LinkExtra != "" {
		if historyMode != "auto" || !linkExtraPattern.MatchString(*payload.LinkExtra) {
			return "", statusError(http.StatusBadRequest)
		}
	}
	return historyMode, nil
}

// invitationDraft is everything stored for a new invitation. The sealed
// values are ciphertext: the plain token never reaches the database.
type invitationDraft struct {
	organizationID, projectID, requestedBy pgtype.UUID
	email, kind, historyMode               string
	tokenHash                              []byte
	expiresAt                              time.Time
	sealedToken, sealedExtra               []byte
}

// storeInvitation replaces the person's pending invitations with a new one and
// queues its e-mail, all in the caller's transaction.
func (h *identityAPI) storeInvitation(ctx context.Context, tx pgx.Tx, q *sqlc.Queries, draft invitationDraft) (uuid.UUID, error) {
	if _, err := q.RevokePendingOrganizationInvitations(ctx, sqlc.RevokePendingOrganizationInvitationsParams{
		OrganizationID: draft.organizationID, EmailNormalized: draft.email,
	}); err != nil {
		return uuid.Nil, err
	}
	created, err := q.CreateOrganizationInvitation(ctx, sqlc.CreateOrganizationInvitationParams{
		OrganizationID: draft.organizationID, EmailNormalized: draft.email,
		MembershipKind: draft.kind, TokenHash: draft.tokenHash,
		ExpiresAt: pgtype.Timestamptz{Time: draft.expiresAt, Valid: true}, HistoryMode: draft.historyMode, ProjectID: draft.projectID,
	})
	if err != nil {
		return uuid.Nil, err
	}
	if err = q.SetInvitationRequester(ctx, sqlc.SetInvitationRequesterParams{ID: created.ID, RequestedBy: draft.requestedBy}); err != nil {
		return uuid.Nil, err
	}
	if err = q.CreateInvitationDelivery(ctx, sqlc.CreateInvitationDeliveryParams{InvitationID: created.ID, TokenCiphertext: draft.sealedToken, ExtraCiphertext: draft.sealedExtra}); err != nil {
		return uuid.Nil, err
	}
	invitationID := uuid.UUID(created.ID.Bytes)
	if _, err = h.auth.jobs.InsertTx(ctx, tx, jobs.InvitationEmailArgs{InvitationID: invitationID.String()}, nil); err != nil {
		return uuid.Nil, err
	}
	return invitationID, nil
}

func (h *identityAPI) AcceptInvitation(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil {
		serverError(w, r, errAuthNotConfigured)
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
	err = h.inTx(ctx, func(q *sqlc.Queries) error {
		invitation, err := q.ClaimOrganizationInvitation(ctx, sqlc.ClaimOrganizationInvitationParams{
			TokenHash: hash[:], EmailNormalized: email,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return statusError(http.StatusBadRequest)
		}
		if err != nil {
			return err
		}
		account, err := h.invitedAccount(ctx, r, q, email, payload.Password)
		if err != nil {
			return err
		}
		if _, err = q.EnsureOrganizationMembership(ctx, sqlc.EnsureOrganizationMembershipParams{
			OrganizationID: invitation.OrganizationID, AccountID: account.ID, MembershipKind: invitation.MembershipKind,
			HistoryMode: invitation.HistoryMode,
		}); errors.Is(err, pgx.ErrNoRows) {
			return statusError(http.StatusBadRequest)
		} else if err != nil {
			return err
		}
		if invitation.ProjectID.Valid {
			if err = placeInvitedMember(ctx, q, invitation.ProjectID, account.ID); err != nil {
				return err
			}
		}
		if err = announceAcceptance(ctx, q, invitation); err != nil {
			return err
		}
		return q.ClearInvitationDeliveryToken(ctx, invitation.ID)
	})
	if respondError(w, r, err) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// invitedAccount returns the account the invitation is for: the signed-in
// owner of an existing account, or a new account created with the given
// password. Anything else is a bad request.
func (h *identityAPI) invitedAccount(ctx context.Context, r *http.Request, q *sqlc.Queries, email string, password *string) (sqlc.Account, error) {
	account, err := q.GetAccountByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		if password == nil {
			return account, statusError(http.StatusBadRequest)
		}
		passwordHash, hashErr := identity.HashPassword(*password)
		if hashErr != nil {
			return account, statusError(http.StatusBadRequest)
		}
		return q.CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: email, PasswordHash: passwordHash})
	}
	if err != nil {
		return account, err
	}
	session, sessionStatus := h.activeSession(r)
	if sessionStatus != http.StatusOK || session.EmailNormalized != email || !account.Active {
		return account, statusError(http.StatusBadRequest)
	}
	return account, nil
}

// placeInvitedMember adds the person to the project they were invited from; the
// key domains learn about them and open boards refresh.
func placeInvitedMember(ctx context.Context, q *sqlc.Queries, projectID, account pgtype.UUID) error {
	if err := q.AddProjectMember(ctx, sqlc.AddProjectMemberParams{ProjectID: projectID, AccountID: account, IsManager: false}); err != nil {
		return err
	}
	if err := refreshProjectDomains(ctx, q, projectID); err != nil {
		return err
	}
	return announceProjectChanged(ctx, q, projectID)
}

// announceAcceptance tells whoever invited that the person arrived, and open
// admin screens refresh.
func announceAcceptance(ctx context.Context, q *sqlc.Queries, invitation sqlc.OrganizationInvitation) error {
	if invitation.RequestedBy.Valid {
		if err := notifyAccount(ctx, q, invitation.RequestedBy, "invitation_accepted", invitation.ID, pgtype.UUID{}, pgtype.UUID{}); err != nil {
			return err
		}
	}
	admins, err := q.ListOrganizationAdmins(ctx, invitation.OrganizationID)
	if err != nil {
		return err
	}
	return emitEvent(ctx, q, admins, eventSpec{Type: "invitation.changed", ResourceID: invitation.ID})
}

func decodeInvitationRequest(w http.ResponseWriter, r *http.Request, payload *gen.CreateInvitationRequest) bool {
	return decodeJSONBody(w, r, payload)
}

// ListInvitations tells administrators which invitations are still waiting and
// which were accepted.
func (h *identityAPI) ListInvitations(w http.ResponseWriter, r *http.Request, params gen.ListInvitationsParams) {
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
		list = append(list, toInvitationStatus(row, now))
	}
	writeJSON(w, http.StatusOK, list)
}

// invitationRow is the common shape of an invitation row, whichever query produced it.
type invitationRow struct {
	ID, ProjectID                      pgtype.UUID
	Email, Kind, HistoryMode, Delivery string
	ExpiresAt, CreatedAt               time.Time
	ConsumedAt                         pgtype.Timestamptz
}

func toInvitationStatus(row invitationRow, now time.Time) gen.InvitationStatus {
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
	return entry
}
