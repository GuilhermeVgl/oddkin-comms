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
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func (h *keysAPI) GetProjectDirectory(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	if _, ok = loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID); !ok {
		return
	}
	members, err := projectRecipients(ctx, q, pgUUID(projectId), "")
	if err != nil {
		serverError(w, r, err)
		return
	}
	devices, err := q.ListActiveDevicesForAccounts(ctx, members)
	if err != nil {
		serverError(w, r, err)
		return
	}
	organizationID, err := q.GetProjectOrganization(ctx, pgUUID(projectId))
	if err != nil {
		serverError(w, r, err)
		return
	}
	recovery, err := q.ListActiveRecoveryDevices(ctx, organizationID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	directory := make([]gen.DirectoryDevice, 0, len(devices)+len(recovery))
	for _, device := range devices {
		directory = append(directory, directoryEntry(device.ID, device.AccountID, device.EmailNormalized, device.Kind, device.State, device.SignPublicKey, device.BoxPublicKey, device.Certificate, device.AuthorizerDeviceID))
	}
	for _, device := range recovery {
		directory = append(directory, directoryEntry(device.ID, device.AccountID, device.EmailNormalized, device.Kind, device.State, device.SignPublicKey, device.BoxPublicKey, device.Certificate, device.AuthorizerDeviceID))
	}
	writeJSON(w, http.StatusOK, directory)
}

func (h *keysAPI) CreateKeyDomain(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.CreateKeyDomainRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var domain sqlc.KeyDomain
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		access, ok := loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID)
		if !ok {
			return errResponded
		}
		if access.access.Kind != "internal" {
			return statusError(http.StatusForbidden)
		}
		organizationID, err := q.GetProjectOrganization(ctx, pgUUID(projectId))
		if err != nil {
			return err
		}
		domain, err = q.CreateKeyDomain(ctx, sqlc.CreateKeyDomainParams{OrganizationID: organizationID, ProjectID: pgUUID(projectId), Kind: string(payload.Kind)})
		if isUniqueViolation(err) {
			return statusError(http.StatusConflict)
		}
		if err != nil {
			return err
		}
		return announceDomain(ctx, q, domain)
	})
	if respondError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusCreated, toKeyDomain(domain))
}

func (h *keysAPI) ListKeyDomains(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
	rows, err := q.ListKeyDomainsForProject(ctx, pgUUID(projectId))
	if err != nil {
		serverError(w, r, err)
		return
	}
	domains := make([]gen.KeyDomain, 0, len(rows))
	for _, row := range rows {
		if access.access.Can(readPermission(row.Kind)) {
			domains = append(domains, toKeyDomain(row))
		}
	}
	writeJSON(w, http.StatusOK, domains)
}

// PublishKeyGeneration stores the next generation of a domain's key, sealed
// for exactly the devices that must hold it. The server checks who may receive
// it and who sealed it; it never sees the key.
func (h *keysAPI) PublishKeyGeneration(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.PublishGenerationRequest
	if !decodeJSONBodyLimit(w, r, &payload, 2<<20) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	var domain sqlc.KeyDomain
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		// The domain row lock makes "next generation" and "recipient set is
		// complete" one atomic decision.
		var err error
		if domain, err = q.LockKeyDomain(ctx, toPG(keyDomainId)); errors.Is(err, pgx.ErrNoRows) {
			return statusError(http.StatusNotFound)
		} else if err != nil {
			return err
		}
		if !requireReader(ctx, w, q, domain, session.AccountID) {
			return errResponded
		}
		signer, err := ownActiveDevice(ctx, q, toPG(payload.SignerDeviceId), session.AccountID)
		if err != nil {
			return err
		}
		if int32(payload.Generation) != domain.CurrentGeneration+1 {
			return statusError(http.StatusConflict)
		}
		required, err := authorizedDevices(ctx, q, domain)
		if err != nil {
			return err
		}
		items := toGrantItems(payload.Envelopes)
		if err = checkEnvelopeRecipients(items, required); err != nil {
			return err
		}
		if err = storeKeyGeneration(ctx, q, domain, signer, payload.Generation, items); err != nil {
			return err
		}
		if err = q.AdvanceKeyDomain(ctx, sqlc.AdvanceKeyDomainParams{ID: domain.ID, CurrentGeneration: int32(payload.Generation)}); err != nil {
			return err
		}
		domain.CurrentGeneration, domain.State = int32(payload.Generation), "ok"
		return announceDomain(ctx, q, domain)
	})
	if respondError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, toKeyDomain(domain))
}

func (h *keysAPI) ListMyKeyEnvelopes(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	domain, err := q.GetKeyDomain(ctx, toPG(keyDomainId))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	if !requireReader(ctx, w, q, domain, session.AccountID) {
		return
	}
	devices, err := q.ListDevicesForAccount(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	var active []pgtype.UUID
	for _, device := range devices {
		if device.State == "active" {
			active = append(active, device.ID)
		}
	}
	rows, err := q.ListEnvelopesForDevices(ctx, sqlc.ListEnvelopesForDevicesParams{DomainID: domain.ID, Devices: active})
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

func directoryEntry(id, account pgtype.UUID, email, kind, state string, sign, box, certificate []byte, authorizer pgtype.UUID) gen.DirectoryDevice {
	entry := gen.DirectoryDevice{
		DeviceId: fromPG(id), AccountId: fromPG(account), Email: email, Kind: gen.DirectoryDeviceKind(kind), State: gen.DirectoryDeviceState(state),
		SignPublicKey: b64(sign), BoxPublicKey: b64(box), Certificate: b64(certificate),
	}
	if authorizer.Valid {
		parent := fromPG(authorizer)
		entry.AuthorizerDeviceId = &parent
	}
	return entry
}

// domainForReader loads a domain and answers 404/403 for non-readers.
func (h *keysAPI) domainForReader(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, id gen.KeyDomainId, account pgtype.UUID) (sqlc.KeyDomain, bool) {
	domain, err := q.GetKeyDomain(ctx, toPG(id))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return domain, false
	}
	if err != nil {
		serverError(w, nil, err)
		return domain, false
	}
	return domain, requireReader(ctx, w, q, domain, account)
}

func (h *keysAPI) ListKeyRecipients(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	domain, ok := h.domainForReader(ctx, w, q, keyDomainId, session.AccountID)
	if !ok {
		return
	}
	rows, err := q.ListAllEnvelopeRecipients(ctx, domain.ID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	recipients := make([]gen.KeyRecipient, 0, len(rows))
	for _, row := range rows {
		recipients = append(recipients, gen.KeyRecipient{Generation: int(row.Generation), DeviceId: fromPG(row.RecipientDeviceID)})
	}
	writeJSON(w, http.StatusOK, recipients)
}

func (h *keysAPI) ListAuthorizedDevices(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	domain, ok := h.domainForReader(ctx, w, q, keyDomainId, session.AccountID)
	if !ok {
		return
	}
	readers, err := domainReaders(ctx, q, domain)
	if err != nil {
		serverError(w, r, err)
		return
	}
	devices, err := q.ListActiveDevicesForAccounts(ctx, readers)
	if err != nil {
		serverError(w, r, err)
		return
	}
	recovery, err := q.ListActiveRecoveryDevices(ctx, domain.OrganizationID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	result := make([]gen.DirectoryDevice, 0, len(devices)+len(recovery))
	for _, device := range devices {
		result = append(result, directoryEntry(device.ID, device.AccountID, device.EmailNormalized, device.Kind, device.State, device.SignPublicKey, device.BoxPublicKey, device.Certificate, device.AuthorizerDeviceID))
	}
	for _, device := range recovery {
		result = append(result, directoryEntry(device.ID, device.AccountID, device.EmailNormalized, device.Kind, device.State, device.SignPublicKey, device.BoxPublicKey, device.Certificate, device.AuthorizerDeviceID))
	}
	writeJSON(w, http.StatusOK, result)
}

// GrantKeyEnvelopes gives authorized devices that lack one an envelope for an
// existing generation, which is how a new member receives the history.
func (h *keysAPI) GrantKeyEnvelopes(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
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
		if _, err := q.LockKeyDomain(ctx, toPG(keyDomainId)); errors.Is(err, pgx.ErrNoRows) {
			return statusError(http.StatusNotFound)
		} else if err != nil {
			return err
		}
		var ok bool
		if domain, ok = h.domainForReader(ctx, w, q, keyDomainId, session.AccountID); !ok {
			return errResponded
		}
		signer, err := ownActiveDevice(ctx, q, toPG(payload.SignerDeviceId), session.AccountID)
		if err != nil {
			return err
		}
		if _, err = applyGrant(ctx, q, domain, signer, payload.Generation, toGrantItems(payload.Envelopes)); err != nil {
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

// GetConversationKeyDomain returns the DM's key domain to either participant.
func (h *keysAPI) GetConversationKeyDomain(w http.ResponseWriter, r *http.Request, conversationId openapi_types.UUID) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	conversation, err := q.GetConversation(ctx, toPG(conversationId))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (conversation.Kind != "dm" || (session.AccountID != conversation.DmLow && session.AccountID != conversation.DmHigh))) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	domain, err := q.GetKeyDomainByConversation(ctx, conversation.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toKeyDomain(domain))
}

func (h *keysAPI) CreateConversationKeyDomain(w http.ResponseWriter, r *http.Request, conversationId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var domain sqlc.KeyDomain
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		conversation, err := q.GetConversation(ctx, toPG(conversationId))
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (session.AccountID != conversation.DmLow && session.AccountID != conversation.DmHigh)) {
			return statusError(http.StatusNotFound)
		}
		if err != nil {
			return err
		}
		if conversation.Kind != "dm" {
			return statusError(http.StatusForbidden)
		}
		organizationID, ok := h.organizationOf(ctx, w, q, session.AccountID)
		if !ok {
			return errResponded
		}
		domain, err = q.CreateDMKeyDomain(ctx, sqlc.CreateDMKeyDomainParams{OrganizationID: organizationID, ConversationID: conversation.ID})
		if isUniqueViolation(err) {
			return statusError(http.StatusConflict)
		}
		if err != nil {
			return err
		}
		return announceDomain(ctx, q, domain)
	})
	if respondError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusCreated, toKeyDomain(domain))
}

func (h *keysAPI) GetSprintKeyDomain(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	if session.MembershipKind != "internal" {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	organizationID, ok := h.organizationOf(ctx, w, q, session.AccountID)
	if !ok {
		return
	}
	domain, err := q.GetSprintKeyDomain(ctx, organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toKeyDomain(domain))
}

func (h *keysAPI) CreateSprintKeyDomain(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var domain sqlc.KeyDomain
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		organizationID, ok := h.organizationOf(ctx, w, q, session.AccountID)
		if !ok {
			return errResponded
		}
		var err error
		domain, err = q.CreateSprintKeyDomain(ctx, organizationID)
		if isUniqueViolation(err) {
			return statusError(http.StatusConflict)
		}
		if err != nil {
			return err
		}
		return announceDomain(ctx, q, domain)
	})
	if respondError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusCreated, toKeyDomain(domain))
}

type grantItem struct {
	recipient         pgtype.UUID
	sealed, signature string
}

// applyGrant stores envelopes for authorized devices that lack the generation
// and returns the devices that received a key. A request that must be refused
// comes back as a statusError.
func applyGrant(ctx context.Context, q *sqlc.Queries, domain sqlc.KeyDomain, signer sqlc.Device, generation int, items []grantItem) ([]pgtype.UUID, error) {
	if generation < 1 || int32(generation) > domain.CurrentGeneration {
		return nil, statusError(http.StatusConflict)
	}
	authorized, err := authorizedDevices(ctx, q, domain)
	if err != nil {
		return nil, err
	}
	holders, err := q.ListEnvelopeRecipients(ctx, sqlc.ListEnvelopeRecipientsParams{DomainID: domain.ID, Generation: int32(generation)})
	if err != nil {
		return nil, err
	}
	var granted []pgtype.UUID
	for _, item := range items {
		if !slices.Contains(authorized, item.recipient) {
			return nil, statusError(http.StatusBadRequest)
		}
		if slices.Contains(holders, item.recipient) {
			return nil, statusError(http.StatusConflict)
		}
		if err = storeKeyEnvelope(ctx, q, domain, signer, generation, item); err != nil {
			return nil, err
		}
		holders = append(holders, item.recipient)
		granted = append(granted, item.recipient)
	}
	return granted, nil
}

// storeKeyGeneration records a new generation and its envelopes, refusing
// (400) any envelope whose signer, recipient or size does not check out.
func storeKeyGeneration(ctx context.Context, q *sqlc.Queries, domain sqlc.KeyDomain, signer sqlc.Device, generation int, items []grantItem) error {
	if err := q.InsertKeyGeneration(ctx, sqlc.InsertKeyGenerationParams{DomainID: domain.ID, Generation: int32(generation), CreatedByDevice: signer.ID}); err != nil {
		return err
	}
	for _, item := range items {
		if err := storeKeyEnvelope(ctx, q, domain, signer, generation, item); err != nil {
			return err
		}
	}
	return nil
}

// storeKeyEnvelope verifies one envelope against the signer and stores it.
func storeKeyEnvelope(ctx context.Context, q *sqlc.Queries, domain sqlc.KeyDomain, signer sqlc.Device, generation int, item grantItem) error {
	sealed, signature, ok := openKeyEnvelope(signer.SignPublicKey, uuidString(domain.ID), item, generation)
	if !ok {
		return statusError(http.StatusBadRequest)
	}
	return q.InsertKeyEnvelope(ctx, sqlc.InsertKeyEnvelopeParams{
		DomainID: domain.ID, Generation: int32(generation), RecipientDeviceID: item.recipient,
		SignerDeviceID: signer.ID, Sealed: sealed, Signature: signature,
	})
}
