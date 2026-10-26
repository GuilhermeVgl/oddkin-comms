package httpapi

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"net/http"
	"slices"

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

// envelopeInput is one sealed key in a request body; the generated request
// types for publishing and granting keys share this exact shape.
type envelopeInput = struct {
	RecipientDeviceId openapi_types.UUID `json:"recipientDeviceId"`

	// Sealed Unpadded base64url (RFC 4648 section 5) of binary data
	Sealed gen.Base64Url `json:"sealed"`

	// Signature Unpadded base64url (RFC 4648 section 5) of binary data
	Signature gen.Base64Url `json:"signature"`
}

func toGrantItems(envelopes []envelopeInput) []grantItem {
	items := make([]grantItem, len(envelopes))
	for i, envelope := range envelopes {
		items[i] = grantItem{recipient: toPG(envelope.RecipientDeviceId), sealed: envelope.Sealed, signature: envelope.Signature}
	}
	return items
}

// ownActiveDevice loads one of the caller's own active devices, the only kind
// that may sign keys. Anything else is a 403, whether it does not exist or
// belongs to someone else.
func ownActiveDevice(ctx context.Context, q *sqlc.Queries, id, account pgtype.UUID) (sqlc.Device, error) {
	device, err := q.GetDevice(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (device.AccountID != account || device.State != "active" || device.Kind != "device")) {
		return device, statusError(http.StatusForbidden)
	}
	return device, err
}

// checkEnvelopeRecipients requires exactly one envelope per required device:
// 400 for one addressed to someone who must not hold the key (or twice to one
// device), 409 when the set is incomplete because membership changed while the
// client was preparing the envelopes.
func checkEnvelopeRecipients(items []grantItem, required []pgtype.UUID) error {
	given := make([]pgtype.UUID, 0, len(items))
	for _, item := range items {
		if slices.Contains(given, item.recipient) || !slices.Contains(required, item.recipient) {
			return statusError(http.StatusBadRequest)
		}
		given = append(given, item.recipient)
	}
	if len(given) != len(required) {
		return statusError(http.StatusConflict)
	}
	return nil
}

// openKeyEnvelope decodes an envelope and checks that signKey signed exactly
// this recipient, domain and generation.
func openKeyEnvelope(signKey []byte, domainID string, item grantItem, generation int) (sealed, signature []byte, ok bool) {
	sealed, validSealed := unb64(item.sealed, 0)
	signature, validSignature := unb64(item.signature, ed25519.SignatureSize)
	if !validSealed || !validSignature || len(sealed) < 48 || len(sealed) > maxSealedKeyBytes {
		return nil, nil, false
	}
	envelope := keys.KeyEnvelope{RecipientDeviceID: uuidString(item.recipient), DomainID: domainID, Generation: uint32(generation), Sealed: sealed}
	if !keys.VerifyKeyEnvelope(signKey, envelope, signature) {
		return nil, nil, false
	}
	return sealed, signature, true
}

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
			serverError(w, nil, err)
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

func (h *keysAPI) organizationOf(ctx context.Context, w http.ResponseWriter, q *sqlc.Queries, account pgtype.UUID) (pgtype.UUID, bool) {
	membership, err := q.GetOrganizationMembershipForAccount(ctx, account)
	if err != nil {
		serverError(w, nil, err)
		return pgtype.UUID{}, false
	}
	return membership.OrganizationID, true
}
