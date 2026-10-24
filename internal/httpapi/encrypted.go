package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/oddkin-comms/internal/keys"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Encrypted content rules (docs/adr/0016-client-side-encryption.md).
//
// Once a project's key domain has a published generation, the server refuses
// plaintext for that kind of content: no silent downgrade. Encrypted writes
// are accepted only with the domain's current generation, a valid signature
// by one of the author's active devices, and the next content revision.

// encFailure is a refusal with a machine-readable reason.
type encFailure struct {
	status int
	code   gen.ApiErrorCode
}

func (f *encFailure) write(w http.ResponseWriter) {
	if f.code == "" {
		w.WriteHeader(f.status)
		return
	}
	writeJSON(w, f.status, gen.ApiError{Code: f.code})
}

// encContext is a validated encrypted write: the domain and the signer.
type encContext struct {
	domain sqlc.KeyDomain
	signer sqlc.Device
}

// domainState looks up a project's key domain; encryption is mandatory once it has a generation.
func domainState(ctx context.Context, q *sqlc.Queries, projectID pgtype.UUID, kind string) (domain sqlc.KeyDomain, found bool, err error) {
	domain, err = q.GetKeyDomainByProjectKind(ctx, sqlc.GetKeyDomainByProjectKindParams{ProjectID: projectID, Kind: kind})
	if errors.Is(err, pgx.ErrNoRows) {
		return domain, false, nil
	}
	return domain, err == nil, err
}

// requirePlaintextAllowed refuses plaintext writes once the domain is encrypted.
func requirePlaintextAllowed(ctx context.Context, q *sqlc.Queries, projectID pgtype.UUID, kind string) (*encFailure, error) {
	domain, found, err := domainState(ctx, q, projectID, kind)
	if err != nil {
		return nil, err
	}
	if found && domain.CurrentGeneration > 0 {
		return &encFailure{http.StatusConflict, gen.ApiErrorCodeEncryptionRequired}, nil
	}
	return nil, nil
}

// prepareEncrypted validates the domain and the signing device for an encrypted write.
func prepareEncrypted(ctx context.Context, q *sqlc.Queries, account, projectID pgtype.UUID, kind string, signerID *pgtype.UUID) (*encContext, *encFailure, error) {
	if signerID == nil || !signerID.Valid {
		return nil, &encFailure{http.StatusBadRequest, gen.ApiErrorCodeBadEnvelope}, nil
	}
	domain, found, err := domainState(ctx, q, projectID, kind)
	if err != nil {
		return nil, nil, err
	}
	if !found || domain.CurrentGeneration == 0 {
		return nil, &encFailure{http.StatusConflict, gen.ApiErrorCodeDomainUnavailable}, nil
	}
	if domain.State == "rotation_required" {
		return nil, &encFailure{http.StatusConflict, gen.ApiErrorCodeRotationRequired}, nil
	}
	signer, err := q.GetDevice(ctx, *signerID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (signer.AccountID != account || signer.State != "active" || signer.Kind != "device")) {
		return nil, &encFailure{http.StatusForbidden, ""}, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return &encContext{domain: domain, signer: signer}, nil, nil
}

// verify checks one envelope: current generation, signature by the signer
// device, and binding to organization, domain, resource, author and revision.
func (c *encContext) verify(account pgtype.UUID, resource string, revision int32, blob string) *encFailure {
	envelope, ok := unb64(blob, 0)
	if !ok || revision < 1 {
		return &encFailure{http.StatusBadRequest, gen.ApiErrorCodeBadEnvelope}
	}
	generation, ok := keys.EnvelopeGeneration(envelope)
	if !ok {
		return &encFailure{http.StatusBadRequest, gen.ApiErrorCodeBadEnvelope}
	}
	if int32(generation) != c.domain.CurrentGeneration {
		return &encFailure{http.StatusConflict, gen.ApiErrorCodeStaleGeneration}
	}
	if !keys.VerifyContentEnvelope(c.signer.SignPublicKey, keys.ContentMetadata{
		OrganizationID: uuidString(c.domain.OrganizationID), DomainID: uuidString(c.domain.ID),
		ResourceID: resource, AuthorID: uuidString(account), Revision: uint64(revision),
	}, envelope) {
		return &encFailure{http.StatusBadRequest, gen.ApiErrorCodeBadEnvelope}
	}
	return nil
}

func blob(value []byte) *string {
	if len(value) == 0 {
		return nil
	}
	encoded := b64(value)
	return &encoded
}

func optionalUUIDValue(id pgtype.UUID) *pgtype.UUID { return &id }

// Resource names bind a ciphertext to the exact field of the exact record.
func workItemResource(id pgtype.UUID, field string) string {
	return "wi:" + uuidString(id) + ":" + field
}
func epicResource(id pgtype.UUID, field string) string { return "ep:" + uuidString(id) + ":" + field }
func commentResource(id pgtype.UUID) string            { return "wc:" + uuidString(id) }
func messageResource(mutationID pgtype.UUID) string    { return "msg:" + uuidString(mutationID) }
