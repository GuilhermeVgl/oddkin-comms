package httpapi

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/keys"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
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
	if row.Proof.Valid {
		device.Proof = &row.Proof.String
	}
	return device
}

// readPermission is the permission that makes someone a reader of a domain.
func readPermission(kind string) string {
	switch kind {
	case "chat":
		return work.ChatRead
	case "files":
		return work.FilesDownload
	}
	return work.WorkRead
}

// domainReaders lists the accounts that may read a domain: project members with
// the matching permission, the two people of a DM, or every internal member for
// the sprint domain.
func domainReaders(ctx context.Context, q *sqlc.Queries, domain sqlc.KeyDomain) ([]pgtype.UUID, error) {
	switch domain.Kind {
	case "dm":
		conversation, err := q.GetConversation(ctx, domain.ConversationID)
		if err != nil {
			return nil, err
		}
		return []pgtype.UUID{conversation.DmLow, conversation.DmHigh}, nil
	case "sprint":
		return q.ListInternalAccounts(ctx, domain.OrganizationID)
	default:
		return projectRecipients(ctx, q, domain.ProjectID, readPermission(domain.Kind))
	}
}

// requireReader answers 404 or 403 unless the account may read the domain.
func requireReader(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, domain sqlc.KeyDomain, account pgtype.UUID) bool {
	switch domain.Kind {
	case "dm":
		conversation, err := q.GetConversation(ctx, domain.ConversationID)
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return false
		}
		if account != conversation.DmLow && account != conversation.DmHigh {
			w.WriteHeader(http.StatusNotFound)
			return false
		}
		return true
	case "sprint":
		membership, err := q.GetOrganizationMembershipForAccount(ctx, account)
		if err != nil || membership.OrganizationID != domain.OrganizationID || membership.MembershipKind != "internal" {
			w.WriteHeader(http.StatusNotFound)
			return false
		}
		return true
	}
	access, ok := loadAccess(ctx, w, q, domain.ProjectID, account)
	if !ok {
		return false
	}
	if !access.access.Can(readPermission(domain.Kind)) {
		w.WriteHeader(http.StatusForbidden)
		return false
	}
	return true
}

// authorizedDevices returns the exact set of devices that must hold a
// domain's current key: active devices of every reader plus the recovery
// identity. Revoked, pending and non-reader devices are never members.
func authorizedDevices(ctx context.Context, q *sqlc.Queries, domain sqlc.KeyDomain) ([]pgtype.UUID, error) {
	readers, err := domainReaders(ctx, q, domain)
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
	_, err := settleDomain(ctx, q, domain)
	return err
}

// refreshDomainAfterGrant is refreshDomain for the moment keys were handed to
// devices: the state may stay the same (a device was already counted as
// waiting), yet the recipients must still hear that something new is there to
// fetch, so the event goes out even when nothing changed.
func refreshDomainAfterGrant(ctx context.Context, q *sqlc.Queries, domain sqlc.KeyDomain) error {
	announced, err := settleDomain(ctx, q, domain)
	if err != nil || announced {
		return err
	}
	return announceDomain(ctx, q, domain)
}

// settleDomain stores the recomputed state and reports whether it announced it.
func settleDomain(ctx context.Context, q *sqlc.Queries, domain sqlc.KeyDomain) (bool, error) {
	state := "pending_keys"
	if domain.CurrentGeneration > 0 {
		authorized, err := authorizedDevices(ctx, q, domain)
		if err != nil {
			return false, err
		}
		holders, err := q.ListEnvelopeRecipients(ctx, sqlc.ListEnvelopeRecipientsParams{DomainID: domain.ID, Generation: domain.CurrentGeneration})
		if err != nil {
			return false, err
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
		return false, nil
	}
	if err := q.SetKeyDomainState(ctx, sqlc.SetKeyDomainStateParams{ID: domain.ID, State: state}); err != nil {
		return false, err
	}
	return true, announceDomain(ctx, q, domain)
}

func announceDomain(ctx context.Context, q *sqlc.Queries, domain sqlc.KeyDomain) error {
	var (
		members []pgtype.UUID
		err     error
	)
	if domain.Kind == "work" || domain.Kind == "chat" || domain.Kind == "files" {
		members, err = projectRecipients(ctx, q, domain.ProjectID, "")
	} else {
		members, err = domainReaders(ctx, q, domain)
	}
	if err != nil {
		return err
	}
	return emitEvent(ctx, q, members, eventSpec{
		Type: "key-domain.changed", ResourceID: domain.ID, ProjectID: domain.ProjectID, ConversationID: domain.ConversationID,
	})
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
	response := gen.KeyDomain{
		Id: fromPG(domain.ID), OrganizationId: fromPG(domain.OrganizationID), Kind: gen.KeyDomainKind(domain.Kind),
		CurrentGeneration: int(domain.CurrentGeneration), State: gen.KeyDomainState(domain.State),
		Writable: domain.State != "rotation_required" && domain.CurrentGeneration > 0,
	}
	if domain.ProjectID.Valid {
		project := fromPG(domain.ProjectID)
		response.ProjectId = &project
	}
	if domain.ConversationID.Valid {
		conversation := fromPG(domain.ConversationID)
		response.ConversationId = &conversation
	}
	return response
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
	proof := ""
	if payload.Proof != nil {
		proof = *payload.Proof
	}
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
		SignPublicKey: signKey, BoxPublicKey: boxKey, Proof: pgtype.Text{String: proof, Valid: proof != ""},
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
	// Administrators learn of a new pending device at once, so an invitation that
	// carries history can be approved without anyone opening a settings page; a
	// person's other devices hear about it too, since they can approve it.
	if admins, adminErr := q.ListOrganizationAdmins(ctx, organizationID); adminErr == nil {
		_ = emitEvent(ctx, q, admins, eventSpec{Type: "device.changed", ResourceID: device.ID})
		if kind == "device" {
			announceDeviceRequest(ctx, q, device, admins, session.AccountID)
		}
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
				Proof: func() *string {
					if row.Proof.Valid {
						return &row.Proof.String
					}
					return nil
				}(),
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
	for _, device := range devices {
		directory = append(directory, directoryEntry(device.ID, device.AccountID, device.EmailNormalized, device.Kind, device.State, device.SignPublicKey, device.BoxPublicKey, device.Certificate, device.AuthorizerDeviceID))
	}
	for _, device := range recovery {
		directory = append(directory, directoryEntry(device.ID, device.AccountID, device.EmailNormalized, device.Kind, device.State, device.SignPublicKey, device.BoxPublicKey, device.Certificate, device.AuthorizerDeviceID))
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
	if !requireReader(ctx, w, q, domain, session.AccountID) {
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
	if !requireReader(ctx, w, q, domain, session.AccountID) {
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

// GetDevice returns the public record of any activated device of the
// organization, including revoked ones: clients need the key of a former
// device to verify what it signed, and to walk certificate chains.
func (h *healthHandler) GetDevice(w http.ResponseWriter, r *http.Request, deviceId gen.DeviceId) {
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
	device, err := q.GetDevice(ctx, pgUUID(uuidFrom(deviceId)))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (device.OrganizationID != organizationID || len(device.Certificate) == 0)) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	owner, err := q.GetAccountByID(ctx, device.AccountID)
	email := ""
	if err == nil {
		email = owner.EmailNormalized
	}
	writeJSON(w, http.StatusOK, directoryEntry(device.ID, device.AccountID, email, device.Kind, device.State, device.SignPublicKey, device.BoxPublicKey, device.Certificate, device.AuthorizerDeviceID))
}

// domainForReader loads a domain and answers 404/403 for non-readers.
func (h *healthHandler) domainForReader(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, id gen.KeyDomainId, account pgtype.UUID) (sqlc.KeyDomain, bool) {
	domain, err := q.GetKeyDomain(ctx, pgUUID(uuidFrom(id)))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return domain, false
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return domain, false
	}
	return domain, requireReader(ctx, w, q, domain, account)
}

func (h *healthHandler) ListKeyRecipients(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	recipients := make([]gen.KeyRecipient, 0, len(rows))
	for _, row := range rows {
		recipients = append(recipients, gen.KeyRecipient{Generation: int(row.Generation), DeviceId: fromPG(row.RecipientDeviceID)})
	}
	writeJSON(w, http.StatusOK, recipients)
}

func (h *healthHandler) ListAuthorizedDevices(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	devices, err := q.ListActiveDevicesForAccounts(ctx, readers)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	recovery, err := q.ListActiveRecoveryDevices(ctx, domain.OrganizationID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
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
func (h *healthHandler) GrantKeyEnvelopes(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
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
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	if _, err = q.LockKeyDomain(ctx, pgUUID(uuidFrom(keyDomainId))); errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	} else if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	domain, ok := h.domainForReader(ctx, w, q, keyDomainId, session.AccountID)
	if !ok {
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
	if payload.Generation < 1 || int32(payload.Generation) > domain.CurrentGeneration {
		w.WriteHeader(http.StatusConflict)
		return
	}
	items := make([]grantItem, len(payload.Envelopes))
	for i, envelope := range payload.Envelopes {
		items[i] = grantItem{recipient: pgUUID(uuidFrom(envelope.RecipientDeviceId)), sealed: envelope.Sealed, signature: envelope.Signature}
	}
	if status, _, grantErr := applyGrant(ctx, q, domain, signer, payload.Generation, items); grantErr != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	} else if status != 0 {
		w.WriteHeader(status)
		return
	}
	if err = refreshDomainAfterGrant(ctx, q, domain); err == nil {
		domain, err = q.GetKeyDomain(ctx, domain.ID)
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

// GetConversationKeyDomain returns the DM's key domain to either participant.
func (h *healthHandler) GetConversationKeyDomain(w http.ResponseWriter, r *http.Request, conversationId openapi_types.UUID) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	conversation, err := q.GetConversation(ctx, pgUUID(uuidFrom(conversationId)))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (conversation.Kind != "dm" || (session.AccountID != conversation.DmLow && session.AccountID != conversation.DmHigh))) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	domain, err := q.GetKeyDomainByConversation(ctx, conversation.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, toKeyDomain(domain))
}

func (h *healthHandler) CreateConversationKeyDomain(w http.ResponseWriter, r *http.Request, conversationId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
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
	conversation, err := q.GetConversation(ctx, pgUUID(uuidFrom(conversationId)))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (session.AccountID != conversation.DmLow && session.AccountID != conversation.DmHigh)) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if conversation.Kind != "dm" {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	organizationID, ok := h.organizationOf(ctx, w, q, session.AccountID)
	if !ok {
		return
	}
	domain, err := q.CreateDMKeyDomain(ctx, sqlc.CreateDMKeyDomainParams{OrganizationID: organizationID, ConversationID: conversation.ID})
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

func (h *healthHandler) GetSprintKeyDomain(w http.ResponseWriter, r *http.Request) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, toKeyDomain(domain))
}

func (h *healthHandler) CreateSprintKeyDomain(w http.ResponseWriter, r *http.Request) {
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
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	organizationID, ok := h.organizationOf(ctx, w, q, session.AccountID)
	if !ok {
		return
	}
	domain, err := q.CreateSprintKeyDomain(ctx, organizationID)
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

type grantItem struct {
	recipient         pgtype.UUID
	sealed, signature string
}

// applyGrant stores envelopes for authorized devices that lack the generation.
// It returns a non-zero HTTP status when a request must be refused, and the
// devices that received a key.
func applyGrant(ctx context.Context, q *sqlc.Queries, domain sqlc.KeyDomain, signer sqlc.Device, generation int, items []grantItem) (int, []pgtype.UUID, error) {
	if generation < 1 || int32(generation) > domain.CurrentGeneration {
		return http.StatusConflict, nil, nil
	}
	authorized, err := authorizedDevices(ctx, q, domain)
	if err != nil {
		return 0, nil, err
	}
	holders, err := q.ListEnvelopeRecipients(ctx, sqlc.ListEnvelopeRecipientsParams{DomainID: domain.ID, Generation: int32(generation)})
	if err != nil {
		return 0, nil, err
	}
	var granted []pgtype.UUID
	for _, item := range items {
		if !slices.Contains(authorized, item.recipient) {
			return http.StatusBadRequest, nil, nil
		}
		if slices.Contains(holders, item.recipient) {
			return http.StatusConflict, nil, nil
		}
		sealed, validSealed := unb64(item.sealed, 0)
		signature, validSignature := unb64(item.signature, ed25519.SignatureSize)
		if !validSealed || !validSignature || len(sealed) < 48 || len(sealed) > maxSealedKeyBytes ||
			!keys.VerifyKeyEnvelope(signer.SignPublicKey, keys.KeyEnvelope{
				RecipientDeviceID: uuidString(item.recipient), DomainID: uuidString(domain.ID), Generation: uint32(generation), Sealed: sealed,
			}, signature) {
			return http.StatusBadRequest, nil, nil
		}
		if err = q.InsertKeyEnvelope(ctx, sqlc.InsertKeyEnvelopeParams{
			DomainID: domain.ID, Generation: int32(generation), RecipientDeviceID: item.recipient,
			SignerDeviceID: signer.ID, Sealed: sealed, Signature: signature,
		}); err != nil {
			return 0, nil, err
		}
		holders = append(holders, item.recipient)
		granted = append(granted, item.recipient)
	}
	return 0, granted, nil
}

// recoveryAdmin answers 403 unless the caller is an administrator whose
// account owns an active recovery identity.
func (h *healthHandler) recoveryAdmin(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, session sqlc.FindActiveSessionByTokenHashRow) (pgtype.UUID, []pgtype.UUID, bool) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
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
func (h *healthHandler) ListRecoveryGaps(w http.ResponseWriter, r *http.Request) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	gaps := []gen.RecoveryGap{}
	for _, domain := range domains {
		if domain.CurrentGeneration == 0 {
			continue
		}
		authorized, authErr := authorizedDevices(ctx, q, domain)
		if authErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		for generation := int32(1); generation <= domain.CurrentGeneration; generation++ {
			holders, listErr := q.ListEnvelopeRecipients(ctx, sqlc.ListEnvelopeRecipientsParams{DomainID: domain.ID, Generation: generation})
			if listErr != nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			for _, id := range authorized {
				if slices.Contains(holders, id) {
					continue
				}
				device, deviceErr := q.GetDevice(ctx, id)
				if deviceErr != nil {
					w.WriteHeader(http.StatusServiceUnavailable)
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

func (h *healthHandler) ListRecoveryEnvelopes(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
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
	domain, err := q.GetKeyDomain(ctx, pgUUID(uuidFrom(keyDomainId)))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && domain.OrganizationID != organizationID) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	rows, err := q.ListEnvelopesForDevices(ctx, sqlc.ListEnvelopesForDevicesParams{DomainID: domain.ID, Devices: recoveryIDs})
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

// GrantRecoveryEnvelopes is the audited path to restore access: the recovery
// administrator, with the recovery identity unlocked locally, re-seals a
// generation for devices that lost theirs. The server only transports it,
// records who did what for whom, and tells the person.
func (h *healthHandler) GrantRecoveryEnvelopes(w http.ResponseWriter, r *http.Request, keyDomainId gen.KeyDomainId) {
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
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	organizationID, _, ok := h.recoveryAdmin(ctx, w, q, session)
	if !ok {
		return
	}
	domain, err := q.LockKeyDomain(ctx, pgUUID(uuidFrom(keyDomainId)))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && domain.OrganizationID != organizationID) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
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
	items := make([]grantItem, len(payload.Envelopes))
	for i, envelope := range payload.Envelopes {
		items[i] = grantItem{recipient: pgUUID(uuidFrom(envelope.RecipientDeviceId)), sealed: envelope.Sealed, signature: envelope.Signature}
	}
	status, granted, err := applyGrant(ctx, q, domain, signer, payload.Generation, items)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if status != 0 {
		w.WriteHeader(status)
		return
	}
	for _, recipient := range granted {
		device, getErr := q.GetDevice(ctx, recipient)
		if getErr == nil {
			err = q.InsertRecoveryAudit(ctx, sqlc.InsertRecoveryAuditParams{
				OrganizationID: organizationID, ApproverAccountID: session.AccountID, ApproverDeviceID: signer.ID,
				DomainID: domain.ID, Generation: int32(payload.Generation), RecipientDeviceID: device.ID, RecipientAccountID: device.AccountID,
			})
			if err == nil && device.AccountID != session.AccountID {
				err = notifyAccount(ctx, q, device.AccountID, "recovery_access", domain.ID, pgtype.UUID{}, pgtype.UUID{})
			}
		} else {
			err = getErr
		}
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
	}
	if err = refreshDomainAfterGrant(ctx, q, domain); err == nil {
		domain, err = q.GetKeyDomain(ctx, domain.ID)
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

func (h *healthHandler) ListRecoveryAudit(w http.ResponseWriter, r *http.Request) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
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

// announceDeviceRequest puts a notification in front of whoever can approve a
// new device: the administrators and the person's own other devices. The
// administrator setting up their very first device is not asking anyone.
func announceDeviceRequest(ctx context.Context, q *sqlc.Queries, device sqlc.Device, admins []pgtype.UUID, account pgtype.UUID) {
	own, err := q.ListDevicesForAccount(ctx, account)
	if err != nil {
		return
	}
	hasActive := false
	for _, other := range own {
		if other.ID != device.ID && other.State == "active" && other.Kind == "device" {
			hasActive = true
		}
	}
	recipients := slices.Clone(admins)
	if hasActive && !slices.Contains(recipients, account) {
		recipients = append(recipients, account)
	}
	for _, recipient := range recipients {
		if recipient == account && !hasActive {
			continue
		}
		_ = notifyAccount(ctx, q, recipient, "device_request", device.ID, pgtype.UUID{}, pgtype.UUID{})
	}
}
