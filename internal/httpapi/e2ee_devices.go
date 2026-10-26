package httpapi

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/keys"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func (h *keysAPI) GetTrustRoot(w http.ResponseWriter, r *http.Request) {
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
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, gen.TrustRoot{SignPublicKey: b64(root.RootSignPublicKey), SetAt: root.SetAt.Time})
}

func (h *keysAPI) SetTrustRoot(w http.ResponseWriter, r *http.Request) {
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
		serverError(w, r, err)
		return
	}
	if created == 0 {
		// The root is pinned once; replacing it would silently re-root every device.
		w.WriteHeader(http.StatusConflict)
		return
	}
	root, err := q.GetTrustRoot(ctx, organizationID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, gen.TrustRoot{SignPublicKey: b64(root.RootSignPublicKey), SetAt: root.SetAt.Time})
}

func (h *keysAPI) RegisterDevice(w http.ResponseWriter, r *http.Request) {
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
		serverError(w, r, err)
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

func (h *keysAPI) ListDevices(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := sqlc.New(h.auth.pool).ListDevicesForAccount(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	devices := make([]gen.Device, 0, len(rows))
	for _, row := range rows {
		devices = append(devices, toDevice(row))
	}
	writeJSON(w, http.StatusOK, devices)
}

func (h *keysAPI) ListPendingDevices(w http.ResponseWriter, r *http.Request) {
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
		serverError(w, r, err)
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

func (h *keysAPI) AuthorizeDevice(w http.ResponseWriter, r *http.Request, deviceId gen.DeviceId) {
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
	var target sqlc.Device
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		var err error
		if target, err = q.GetDevice(ctx, toPG(deviceId)); errors.Is(err, pgx.ErrNoRows) {
			return statusError(http.StatusNotFound)
		} else if err != nil {
			return err
		}
		signer, authorizer, err := h.certifyingKey(ctx, w, q, session, target, payload.AuthorizerDeviceId)
		if err != nil {
			return err
		}
		if target.State != "pending" {
			return statusError(http.StatusConflict)
		}
		if !keys.VerifyDeviceCertificate(signer, keys.DeviceCertificate{
			AccountID: uuidString(target.AccountID), DeviceID: uuidString(target.ID),
			SignPublicKey: target.SignPublicKey, BoxPublicKey: target.BoxPublicKey,
		}, certificate) {
			return statusError(http.StatusBadRequest)
		}
		return activateDevice(ctx, q, target, certificate, authorizer)
	})
	if respondError(w, r, err) {
		return
	}
	activated, err := sqlc.New(h.auth.pool).GetDevice(ctx, target.ID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toDevice(activated))
}

func (h *keysAPI) RevokeDevice(w http.ResponseWriter, r *http.Request, deviceId gen.DeviceId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		target, err := q.GetDevice(ctx, toPG(deviceId))
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && target.AccountID != session.AccountID && !session.IsAdmin) {
			return statusError(http.StatusNotFound)
		}
		if err != nil {
			return err
		}
		if _, err = q.RevokeDevice(ctx, target.ID); err != nil {
			return err
		}
		if err = refreshAccountDomains(ctx, q, target); err != nil {
			return err
		}
		return emitEvent(ctx, q, []pgtype.UUID{target.AccountID}, eventSpec{Type: "device.changed", ResourceID: target.ID})
	})
	if respondError(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetDevice returns the public record of any activated device of the
// organization, including revoked ones: clients need the key of a former
// device to verify what it signed, and to walk certificate chains.
func (h *keysAPI) GetDevice(w http.ResponseWriter, r *http.Request, deviceId gen.DeviceId) {
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
	device, err := q.GetDevice(ctx, toPG(deviceId))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (device.OrganizationID != organizationID || len(device.Certificate) == 0)) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	owner, err := q.GetAccountByID(ctx, device.AccountID)
	email := ""
	if err == nil {
		email = owner.EmailNormalized
	}
	writeJSON(w, http.StatusOK, directoryEntry(device.ID, device.AccountID, email, device.Kind, device.State, device.SignPublicKey, device.BoxPublicKey, device.Certificate, device.AuthorizerDeviceID))
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

// certifyingKey picks who vouches for a new device and returns that signer's
// public key plus the vouching device (invalid when the trust root signs). The
// trust root signs for an administrator; otherwise an existing active device of
// the same person does.
func (h *keysAPI) certifyingKey(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, session sqlc.FindActiveSessionByTokenHashRow, target sqlc.Device, authorizerID *openapi_types.UUID) (ed25519.PublicKey, pgtype.UUID, error) {
	if authorizerID != nil {
		// An existing device of the same person vouches for the new one.
		if target.AccountID != session.AccountID || target.Kind != "device" {
			return nil, pgtype.UUID{}, statusError(http.StatusForbidden)
		}
		existing, err := ownActiveDevice(ctx, q, toPG(*authorizerID), session.AccountID)
		if err != nil {
			return nil, pgtype.UUID{}, err
		}
		return existing.SignPublicKey, existing.ID, nil
	}
	// The trust root signs: only an administrator can present it.
	if !session.IsAdmin {
		return nil, pgtype.UUID{}, statusError(http.StatusForbidden)
	}
	organizationID, ok := h.organizationOf(ctx, w, q, session.AccountID)
	if !ok {
		return nil, pgtype.UUID{}, errResponded
	}
	if target.OrganizationID != organizationID {
		return nil, pgtype.UUID{}, statusError(http.StatusNotFound)
	}
	root, err := q.GetTrustRoot(ctx, organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, pgtype.UUID{}, statusError(http.StatusConflict)
	}
	if err != nil {
		return nil, pgtype.UUID{}, err
	}
	return root.RootSignPublicKey, pgtype.UUID{}, nil
}

// activateDevice marks a pending device active and tells everyone who must hear
// about it: the domains it can now read and its owner's other devices.
func activateDevice(ctx context.Context, q *sqlc.Queries, target sqlc.Device, certificate []byte, authorizer pgtype.UUID) error {
	changed, err := q.ActivateDevice(ctx, sqlc.ActivateDeviceParams{ID: target.ID, Certificate: certificate, AuthorizerDeviceID: authorizer})
	if err != nil {
		return err
	}
	if changed == 0 {
		return statusError(http.StatusConflict)
	}
	target.State = "active"
	if err = refreshAccountDomains(ctx, q, target); err != nil {
		return err
	}
	return emitEvent(ctx, q, []pgtype.UUID{target.AccountID}, eventSpec{Type: "device.changed", ResourceID: target.ID})
}
