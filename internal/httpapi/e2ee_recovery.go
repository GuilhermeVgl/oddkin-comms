package httpapi

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// recoveryAdmin answers 403 unless the caller is an administrator whose
// account owns an active recovery identity.
func (h *keysAPI) recoveryAdmin(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, session sqlc.FindActiveSessionByTokenHashRow) (pgtype.UUID, []pgtype.UUID, bool) {
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return pgtype.UUID{}, nil, false
	}
	organizationID, ok := h.organizationOf(ctx, w, q, session.AccountID)
	if !ok {
		return pgtype.UUID{}, nil, false
	}
	recovery, err := q.ListActiveRecoveryDevices(ctx, organizationID)
	if err != nil {
		serverError(w, nil, err)
		return pgtype.UUID{}, nil, false
	}
	var mine []pgtype.UUID
	for _, device := range recovery {
		if device.AccountID == session.AccountID {
			mine = append(mine, device.ID)
		}
	}
	if len(mine) == 0 {
		w.WriteHeader(http.StatusForbidden)
		return pgtype.UUID{}, nil, false
	}
	return organizationID, mine, true
}

// ListRecoveryGaps lists every (domain, generation, device) where an authorized
// device cannot read yet. Only the recovery administrator sees it, by design:
// the recovery identity can restore access anywhere in the organization.
func (h *keysAPI) ListRecoveryGaps(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	organizationID, _, ok := h.recoveryAdmin(ctx, w, q, session)
	if !ok {
		return
	}
	domains, err := q.ListKeyDomainsForOrganization(ctx, organizationID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	gaps := []gen.RecoveryGap{}
	for _, domain := range domains {
		if domain.CurrentGeneration == 0 {
			continue
		}
		authorized, authErr := authorizedDevices(ctx, q, domain)
		if authErr != nil {
			serverError(w, r, authErr)
			return
		}
		for generation := int32(1); generation <= domain.CurrentGeneration; generation++ {
			holders, listErr := q.ListEnvelopeRecipients(ctx, sqlc.ListEnvelopeRecipientsParams{DomainID: domain.ID, Generation: generation})
			if listErr != nil {
				serverError(w, r, listErr)
				return
			}
			for _, id := range authorized {
				if slices.Contains(holders, id) {
					continue
				}
				device, deviceErr := q.GetDevice(ctx, id)
				if deviceErr != nil {
					serverError(w, r, deviceErr)
					return
				}
				email := ""
				if owner, ownerErr := q.GetAccountByID(ctx, device.AccountID); ownerErr == nil {
					email = owner.EmailNormalized
				}
				gap := gen.RecoveryGap{
					DomainId: fromPG(domain.ID), Kind: gen.RecoveryGapKind(domain.Kind), Generation: int(generation),
					Device: directoryEntry(device.ID, device.AccountID, email, device.Kind, device.State, device.SignPublicKey, device.BoxPublicKey, device.Certificate, device.AuthorizerDeviceID),
				}
				if domain.ProjectID.Valid {
					project := fromPG(domain.ProjectID)
					gap.ProjectId = &project
				}
				if domain.ConversationID.Valid {
					conversation := fromPG(domain.ConversationID)
					gap.ConversationId = &conversation
				}
				gaps = append(gaps, gap)
			}
		}
	}
	writeJSON(w, http.StatusOK, gaps)
}

func (h *keysAPI) ListRecoveryEnvelopes(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	organizationID, recoveryIDs, ok := h.recoveryAdmin(ctx, w, q, session)
	if !ok {
		return
	}
	domain, err := q.GetKeyDomain(ctx, toPG(keyDomainId))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && domain.OrganizationID != organizationID) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	rows, err := q.ListEnvelopesForDevices(ctx, sqlc.ListEnvelopesForDevicesParams{DomainID: domain.ID, Devices: recoveryIDs})
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

// GrantRecoveryEnvelopes is the audited path to restore access: the recovery
// administrator, with the recovery identity unlocked locally, re-seals a
// generation for devices that lost theirs. The server only transports it,
// records who did what for whom, and tells the person.
func (h *keysAPI) GrantRecoveryEnvelopes(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.GrantEnvelopesRequest
	if !decodeJSONBodyLimit(w, r, &payload, 2<<20) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	var domain sqlc.KeyDomain
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		organizationID, _, ok := h.recoveryAdmin(ctx, w, q, session)
		if !ok {
			return errResponded
		}
		var err error
		domain, err = q.LockKeyDomain(ctx, toPG(keyDomainId))
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && domain.OrganizationID != organizationID) {
			return statusError(http.StatusNotFound)
		}
		if err != nil {
			return err
		}
		signer, err := ownActiveDevice(ctx, q, toPG(payload.SignerDeviceId), session.AccountID)
		if err != nil {
			return err
		}
		granted, err := applyGrant(ctx, q, domain, signer, payload.Generation, toGrantItems(payload.Envelopes))
		if err != nil {
			return err
		}
		audit := recoveryGrantAudit{organizationID: organizationID, approver: session.AccountID, approverDevice: signer.ID, domain: domain.ID, generation: payload.Generation}
		if err = audit.record(ctx, q, granted); err != nil {
			return err
		}
		if err = refreshDomainAfterGrant(ctx, q, domain); err != nil {
			return err
		}
		domain, err = q.GetKeyDomain(ctx, domain.ID)
		return err
	})
	if respondError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, toKeyDomain(domain))
}

func (h *keysAPI) ListRecoveryAudit(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	organizationID, ok := h.organizationOf(ctx, w, q, session.AccountID)
	if !ok {
		return
	}
	rows, err := q.ListRecoveryAudit(ctx, organizationID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	entries := make([]gen.RecoveryAuditEntry, 0, len(rows))
	for _, row := range rows {
		entry := gen.RecoveryAuditEntry{
			Id: fromPG(row.ID), CreatedAt: row.CreatedAt.Time, Generation: int(row.Generation), DomainKind: row.DomainKind,
			ApproverEmail: row.ApproverEmail, RecipientEmail: row.RecipientEmail,
		}
		if row.DomainID.Valid {
			domain := fromPG(row.DomainID)
			entry.DomainId = &domain
		}
		entries = append(entries, entry)
	}
	writeJSON(w, http.StatusOK, entries)
}

// recoveryGrantAudit is who restored which generation of which domain.
type recoveryGrantAudit struct {
	organizationID, approver, approverDevice, domain pgtype.UUID
	generation                                       int
}

// record writes one audit row per device that received a key and tells the
// owner, unless the owner is the approver.
func (a recoveryGrantAudit) record(ctx context.Context, q *sqlc.Queries, recipients []pgtype.UUID) error {
	for _, recipient := range recipients {
		device, err := q.GetDevice(ctx, recipient)
		if err != nil {
			return err
		}
		if err = q.InsertRecoveryAudit(ctx, sqlc.InsertRecoveryAuditParams{
			OrganizationID: a.organizationID, ApproverAccountID: a.approver, ApproverDeviceID: a.approverDevice,
			DomainID: a.domain, Generation: int32(a.generation), RecipientDeviceID: device.ID, RecipientAccountID: device.AccountID,
		}); err != nil {
			return err
		}
		if device.AccountID != a.approver {
			if err = notifyAccount(ctx, q, device.AccountID, "recovery_access", a.domain, pgtype.UUID{}, pgtype.UUID{}); err != nil {
				return err
			}
		}
	}
	return nil
}
