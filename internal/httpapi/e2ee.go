package httpapi

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/oddkin-comms/internal/keys"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/oddkin-comms/internal/work"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// The server stores and verifies public material only. It never receives a
// secret key or a plaintext; see docs/adr/0015-e2ee-key-directory.md.

const maxSealedKeyBytes = 1024

func b64(value []byte) string { return base64.RawURLEncoding.EncodeToString(value) }

func unb64(value string, exactly int) ([]byte, bool) {
	raw, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil || (exactly > 0 && len(raw) != exactly) {
		return nil, false
	}
	return raw, true
}

func uuidString(id pgtype.UUID) string { return uuid.UUID(id.Bytes).String() }

func toDevice(row sqlc.Device) gen.Device {
	device := gen.Device{
		Id: fromPG(row.ID), Name: row.Name, Kind: gen.DeviceKind(row.Kind), State: gen.DeviceState(row.State),
		SignPublicKey: b64(row.SignPublicKey), BoxPublicKey: b64(row.BoxPublicKey),
	}
	if len(row.Certificate) > 0 {
		certificate := b64(row.Certificate)
		device.Certificate = &certificate
	}
	return device
}

// readPermission is the permission that makes someone a reader of a domain.
func readPermission(kind string) string {
	if kind == "chat" {
		return work.ChatRead
	}
	return work.WorkRead
}

// authorizedDevices returns the exact set of devices that must hold a
// domain's current key: active devices of every reader plus the recovery
// identity. Revoked, pending and non-reader devices are never members.
func authorizedDevices(ctx context.Context, q *sqlc.Queries, domain sqlc.KeyDomain) ([]pgtype.UUID, error) {
	readers, err := projectRecipients(ctx, q, domain.ProjectID, readPermission(domain.Kind))
	if err != nil {
		return nil, err
	}
	devices, err := q.ListActiveDevicesForAccounts(ctx, readers)
	if err != nil {
		return nil, err
	}
	recovery, err := q.ListActiveRecoveryDevices(ctx, domain.OrganizationID)
	if err != nil {
		return nil, err
	}
	ids := make([]pgtype.UUID, 0, len(devices)+len(recovery))
	for _, device := range devices {
		ids = append(ids, device.ID)
	}
	for _, device := range recovery {
		ids = append(ids, device.ID)
	}
	return ids, nil
}

// refreshDomain recomputes a domain's state from reality. Someone who holds the
// current key but is no longer authorized forces a rotation (writes stop until
// a new generation exists); someone authorized who holds nothing yet leaves the
// domain waiting for keys. Clients are told through the event feed.
func refreshDomain(ctx context.Context, q *sqlc.Queries, domain sqlc.KeyDomain) error {
	state := "pending_keys"
	if domain.CurrentGeneration > 0 {
		authorized, err := authorizedDevices(ctx, q, domain)
		if err != nil {
			return err
		}
		holders, err := q.ListEnvelopeRecipients(ctx, sqlc.ListEnvelopeRecipientsParams{DomainID: domain.ID, Generation: domain.CurrentGeneration})
		if err != nil {
			return err
		}
		switch {
		case slices.ContainsFunc(holders, func(id pgtype.UUID) bool { return !slices.Contains(authorized, id) }):
			state = "rotation_required"
		case slices.ContainsFunc(authorized, func(id pgtype.UUID) bool { return !slices.Contains(holders, id) }):
			state = "pending_keys"
		default:
			state = "ok"
		}
	}
	if state == domain.State {
		return nil
	}
	if err := q.SetKeyDomainState(ctx, sqlc.SetKeyDomainStateParams{ID: domain.ID, State: state}); err != nil {
		return err
	}
	return announceDomain(ctx, q, domain)
}

func announceDomain(ctx context.Context, q *sqlc.Queries, domain sqlc.KeyDomain) error {
	members, err := projectRecipients(ctx, q, domain.ProjectID, "")
	if err != nil {
		return err
	}
	return emitEvent(ctx, q, members, eventSpec{Type: "key-domain.changed", ResourceID: domain.ID, ProjectID: domain.ProjectID})
}

func refreshProjectDomains(ctx context.Context, q *sqlc.Queries, projectID pgtype.UUID) error {
	domains, err := q.ListKeyDomainsForProject(ctx, projectID)
	if err != nil {
		return err
	}
	for _, domain := range domains {
		if err = refreshDomain(ctx, q, domain); err != nil {
			return err
		}
	}
	return nil
}

func refreshAccountDomains(ctx context.Context, q *sqlc.Queries, device sqlc.Device) error {
	var (
		domains []sqlc.KeyDomain
		err     error
	)
	if device.Kind == "recovery" {
		domains, err = q.ListKeyDomainsForOrganization(ctx, device.OrganizationID)
	} else {
		domains, err = q.ListKeyDomainsForAccount(ctx, device.AccountID)
	}
	if err != nil {
		return err
	}
	for _, domain := range domains {
		if err = refreshDomain(ctx, q, domain); err != nil {
			return err
		}
	}
	return nil
}

func toKeyDomain(domain sqlc.KeyDomain) gen.KeyDomain {
	return gen.KeyDomain{
		Id: fromPG(domain.ID), ProjectId: fromPG(domain.ProjectID), Kind: gen.KeyDomainKind(domain.Kind),
		CurrentGeneration: int(domain.CurrentGeneration), State: gen.KeyDomainState(domain.State),
		Writable: domain.State != "rotation_required" && domain.CurrentGeneration > 0,
	}
}

func (h *healthHandler) organizationOf(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, account pgtype.UUID) (pgtype.UUID, bool) {
	membership, err := q.GetOrganizationMembershipForAccount(ctx, account)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return pgtype.UUID{}, false
	}
	return membership.OrganizationID, true
}

func (h *healthHandler) GetTrustRoot(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	organizationID, ok := h.organizationOf(ctx, w, q, session.AccountID)
	if !ok {
		return
	}
	root, err := q.GetTrustRoot(ctx, organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, gen.TrustRoot{SignPublicKey: b64(root.RootSignPublicKey), SetAt: root.SetAt.Time})
}

func (h *healthHandler) SetTrustRoot(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var payload gen.SetTrustRootRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	key, valid := unb64(payload.SignPublicKey, ed25519.PublicKeySize)
	if !valid {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	organizationID, ok := h.organizationOf(ctx, w, q, session.AccountID)
	if !ok {
		return
	}
	created, err := q.SetTrustRoot(ctx, sqlc.SetTrustRootParams{OrganizationID: organizationID, RootSignPublicKey: key, SetBy: session.AccountID})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if created == 0 {
		// The root is pinned once; replacing it would silently re-root every device.
		w.WriteHeader(http.StatusConflict)
		return
	}
	root, err := q.GetTrustRoot(ctx, organizationID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, gen.TrustRoot{SignPublicKey: b64(root.RootSignPublicKey), SetAt: root.SetAt.Time})
}

func (h *healthHandler) RegisterDevice(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.RegisterDeviceRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	signKey, validSign := unb64(payload.SignPublicKey, 32)
	boxKey, validBox := unb64(payload.BoxPublicKey, 32)
	kind := "device"
	if payload.Kind != nil {
		kind = string(*payload.Kind)
	}
	if !validSign || !validBox || (kind == "recovery" && !session.IsAdmin) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	organizationID, ok := h.organizationOf(ctx, w, q, session.AccountID)
	if !ok {
		return
	}
	device, err := q.CreateDevice(ctx, sqlc.CreateDeviceParams{
		OrganizationID: organizationID, AccountID: session.AccountID, Kind: kind, Name: payload.Name,
		SignPublicKey: signKey, BoxPublicKey: boxKey,
	})
	if isUniqueViolation(err) {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if isConstraintViolation(err) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusCreated, toDevice(device))
}

func (h *healthHandler) ListDevices(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := sqlc.New(h.auth.pool).ListDevicesForAccount(ctx, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	devices := make([]gen.Device, 0, len(rows))
	for _, row := range rows {
		devices = append(devices, toDevice(row))
	}
	writeJSON(w, http.StatusOK, devices)
}

func (h *healthHandler) ListPendingDevices(w http.ResponseWriter, r *http.Request) {
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
	rows, err := q.ListPendingDevices(ctx, organizationID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	pending := make([]gen.PendingDevice, 0, len(rows))
	for _, row := range rows {
		pending = append(pending, gen.PendingDevice{
			Device: gen.Device{
				Id: fromPG(row.ID), Name: row.Name, Kind: gen.DeviceKind(row.Kind), State: gen.DeviceState(row.State),
				SignPublicKey: b64(row.SignPublicKey), BoxPublicKey: b64(row.BoxPublicKey),
			},
			AccountId: fromPG(row.AccountID), Email: row.EmailNormalized,
		})
	}
	writeJSON(w, http.StatusOK, pending)
}

func (h *healthHandler) AuthorizeDevice(w http.ResponseWriter, r *http.Request, deviceId gen.DeviceId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.AuthorizeDeviceRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	certificate, valid := unb64(payload.Certificate, ed25519.SignatureSize)
	if !valid {
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
	target, err := q.GetDevice(ctx, pgUUID(uuidFrom(deviceId)))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	var (
		signer     ed25519.PublicKey
		authorizer pgtype.UUID
	)
	if payload.AuthorizerDeviceId == nil {
		// The trust root signs: only an administrator can present it.
		if !session.IsAdmin {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		organizationID, orgOK := h.organizationOf(ctx, w, q, session.AccountID)
		if !orgOK {
			return
		}
		if target.OrganizationID != organizationID {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		root, rootErr := q.GetTrustRoot(ctx, organizationID)
		if errors.Is(rootErr, pgx.ErrNoRows) {
			w.WriteHeader(http.StatusConflict)
			return
		}
		if rootErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		signer = root.RootSignPublicKey
	} else {
		// An existing device of the same person vouches for the new one.
		if target.AccountID != session.AccountID || target.Kind != "device" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		existing, getErr := q.GetDevice(ctx, pgUUID(uuidFrom(*payload.AuthorizerDeviceId)))
		if errors.Is(getErr, pgx.ErrNoRows) || (getErr == nil && (existing.AccountID != session.AccountID || existing.State != "active" || existing.Kind != "device")) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if getErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		signer, authorizer = existing.SignPublicKey, existing.ID
	}
	if target.State != "pending" {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if !keys.VerifyDeviceCertificate(signer, keys.DeviceCertificate{
		AccountID: uuidString(target.AccountID), DeviceID: uuidString(target.ID),
		SignPublicKey: target.SignPublicKey, BoxPublicKey: target.BoxPublicKey,
	}, certificate) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	changed, err := q.ActivateDevice(ctx, sqlc.ActivateDeviceParams{ID: target.ID, Certificate: certificate, AuthorizerDeviceID: authorizer})
	if err == nil && changed == 0 {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err == nil {
		target.State = "active"
		err = refreshAccountDomains(ctx, q, target)
	}
	if err == nil {
		err = emitEvent(ctx, q, []pgtype.UUID{target.AccountID}, eventSpec{Type: "device.changed", ResourceID: target.ID})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	activated, err := sqlc.New(h.auth.pool).GetDevice(ctx, target.ID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, toDevice(activated))
}

func (h *healthHandler) RevokeDevice(w http.ResponseWriter, r *http.Request, deviceId gen.DeviceId) {
	session, ok := h.mutator(w, r)
	if !ok {
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
	target, err := q.GetDevice(ctx, pgUUID(uuidFrom(deviceId)))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && target.AccountID != session.AccountID && !session.IsAdmin) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if _, err = q.RevokeDevice(ctx, target.ID); err == nil {
		err = refreshAccountDomains(ctx, q, target)
	}
	if err == nil {
		err = emitEvent(ctx, q, []pgtype.UUID{target.AccountID}, eventSpec{Type: "device.changed", ResourceID: target.ID})
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

func (h *healthHandler) GetProjectDirectory(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	devices, err := q.ListActiveDevicesForAccounts(ctx, members)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	organizationID, err := q.GetProjectOrganization(ctx, pgUUID(projectId))
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	recovery, err := q.ListActiveRecoveryDevices(ctx, organizationID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	directory := make([]gen.DirectoryDevice, 0, len(devices)+len(recovery))
	add := func(id, account pgtype.UUID, email, kind string, sign, box, certificate []byte, authorizer pgtype.UUID) {
		entry := gen.DirectoryDevice{
			DeviceId: fromPG(id), AccountId: fromPG(account), Email: email, Kind: gen.DirectoryDeviceKind(kind),
			SignPublicKey: b64(sign), BoxPublicKey: b64(box), Certificate: b64(certificate),
		}
		if authorizer.Valid {
			parent := fromPG(authorizer)
			entry.AuthorizerDeviceId = &parent
		}
		directory = append(directory, entry)
	}
	for _, device := range devices {
		add(device.ID, device.AccountID, device.EmailNormalized, device.Kind, device.SignPublicKey, device.BoxPublicKey, device.Certificate, device.AuthorizerDeviceID)
	}
	for _, device := range recovery {
		add(device.ID, device.AccountID, device.EmailNormalized, device.Kind, device.SignPublicKey, device.BoxPublicKey, device.Certificate, device.AuthorizerDeviceID)
	}
	writeJSON(w, http.StatusOK, directory)
}

func (h *healthHandler) CreateKeyDomain(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	access, ok := loadAccess(ctx, w, q, pgUUID(projectId), session.AccountID)
	if !ok {
		return
	}
	if access.access.Kind != "internal" {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	organizationID, err := q.GetProjectOrganization(ctx, pgUUID(projectId))
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	domain, err := q.CreateKeyDomain(ctx, sqlc.CreateKeyDomainParams{OrganizationID: organizationID, ProjectID: pgUUID(projectId), Kind: string(payload.Kind)})
	if isUniqueViolation(err) {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err == nil {
		err = announceDomain(ctx, q, domain)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusCreated, toKeyDomain(domain))
}

func (h *healthHandler) ListKeyDomains(w http.ResponseWriter, r *http.Request, projectId gen.ProjectId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
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

func (h *healthHandler) PublishKeyGeneration(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
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
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	// The domain row lock makes "next generation" and "recipient set is
	// complete" one atomic decision.
	domain, err := q.LockKeyDomain(ctx, pgUUID(uuidFrom(keyDomainId)))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	access, ok := loadAccess(ctx, w, q, domain.ProjectID, session.AccountID)
	if !ok {
		return
	}
	if !access.access.Can(readPermission(domain.Kind)) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	signer, err := q.GetDevice(ctx, pgUUID(uuidFrom(payload.SignerDeviceId)))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (signer.AccountID != session.AccountID || signer.State != "active" || signer.Kind != "device")) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if int32(payload.Generation) != domain.CurrentGeneration+1 {
		w.WriteHeader(http.StatusConflict)
		return
	}
	required, err := authorizedDevices(ctx, q, domain)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	given := make([]pgtype.UUID, 0, len(payload.Envelopes))
	for _, envelope := range payload.Envelopes {
		recipient := pgUUID(uuidFrom(envelope.RecipientDeviceId))
		if slices.Contains(given, recipient) || !slices.Contains(required, recipient) {
			// An envelope for someone who must not hold this key (or twice for one device).
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		given = append(given, recipient)
	}
	if len(given) != len(required) {
		// Membership or devices changed while the client was preparing envelopes.
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err = q.InsertKeyGeneration(ctx, sqlc.InsertKeyGenerationParams{DomainID: domain.ID, Generation: int32(payload.Generation), CreatedByDevice: signer.ID}); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	for _, envelope := range payload.Envelopes {
		sealed, validSealed := unb64(envelope.Sealed, 0)
		signature, validSignature := unb64(envelope.Signature, ed25519.SignatureSize)
		recipient := pgUUID(uuidFrom(envelope.RecipientDeviceId))
		if !validSealed || !validSignature || len(sealed) < 48 || len(sealed) > maxSealedKeyBytes ||
			!keys.VerifyKeyEnvelope(signer.SignPublicKey, keys.KeyEnvelope{
				RecipientDeviceID: uuidString(recipient), DomainID: uuidString(domain.ID), Generation: uint32(payload.Generation), Sealed: sealed,
			}, signature) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if err = q.InsertKeyEnvelope(ctx, sqlc.InsertKeyEnvelopeParams{
			DomainID: domain.ID, Generation: int32(payload.Generation), RecipientDeviceID: recipient,
			SignerDeviceID: signer.ID, Sealed: sealed, Signature: signature,
		}); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
	}
	if err = q.AdvanceKeyDomain(ctx, sqlc.AdvanceKeyDomainParams{ID: domain.ID, CurrentGeneration: int32(payload.Generation)}); err == nil {
		domain.CurrentGeneration, domain.State = int32(payload.Generation), "ok"
		err = announceDomain(ctx, q, domain)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, toKeyDomain(domain))
}

func (h *healthHandler) ListMyKeyEnvelopes(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	domain, err := q.GetKeyDomain(ctx, pgUUID(uuidFrom(keyDomainId)))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	access, ok := loadAccess(ctx, w, q, domain.ProjectID, session.AccountID)
	if !ok {
		return
	}
	if !access.access.Can(readPermission(domain.Kind)) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	devices, err := q.ListDevicesForAccount(ctx, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
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
