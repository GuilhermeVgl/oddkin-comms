package httpapi

import (
	"bytes"
	"context"
	"errors"
	"net/http"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/platform/objectstore"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Encrypted file objects (ADR 0019): "CSKF" | version | manifest envelope |
// records. The manifest envelope is a signed content envelope of fixed size, so
// the encrypted size is a function of the original size and can be checked.
const (
	fileMagic          = "CSKF"
	fileFormatVersion  = 1
	fileManifestLength = 182 // 30-byte header + 72 plaintext + 16 tag + 64 signature
	fileHeaderLength   = len(fileMagic) + 1 + fileManifestLength
	fileRecordSize     = 262144
	fileRecordOverhead = 17
	maxFileOverhead    = 100_000 // generous bound for the database constraint
)

// plaintextSizeFor inverts C = 187 + n + 17*ceil(n/262144). It reports false
// when no file size produces the encrypted size C.
func plaintextSizeFor(encrypted int64) (int64, bool) {
	body := encrypted - int64(fileHeaderLength)
	if body <= fileRecordOverhead {
		return 0, false
	}
	records := (body + fileRecordSize + fileRecordOverhead - 1) / (fileRecordSize + fileRecordOverhead)
	original := body - fileRecordOverhead*records
	if original < 1 || (original+fileRecordSize-1)/fileRecordSize != records {
		return 0, false
	}
	return original, true
}

func attachmentManifestResource(id pgtype.UUID) string { return "at:" + uuidString(id) + ":manifest" }

// bodyDomain is the key domain that protects the bodies of files in a context:
// the project's files domain, or the DM's own domain.
func bodyDomain(ctx context.Context, q *sqlc.Queries, target fileContext) (sqlc.KeyDomain, bool, error) {
	if target.conversationID.Valid {
		conversation, err := q.GetConversation(ctx, target.conversationID)
		if err != nil {
			return sqlc.KeyDomain{}, false, err
		}
		if conversation.Kind == "dm" {
			domain, err := q.GetKeyDomainByConversation(ctx, conversation.ID)
			if err != nil {
				if isNoRows(err) {
					return domain, false, nil
				}
				return domain, false, err
			}
			return domain, true, nil
		}
	}
	return domainState(ctx, q, target.projectID, "files")
}

// bodyEncryptionFailure enforces "no downgrade" for bodies: once the body
// domain has a generation, a plaintext body is refused; without one, an
// encrypted body has nothing to be encrypted under.
func bodyEncryptionFailure(domain sqlc.KeyDomain, found, encrypted bool) *encFailure {
	required := found && domain.CurrentGeneration > 0
	switch {
	case required && !encrypted:
		return &encFailure{http.StatusConflict, gen.ApiErrorCodeEncryptionRequired}
	case !required && encrypted:
		return &encFailure{http.StatusConflict, gen.ApiErrorCodeDomainUnavailable}
	}
	return nil
}

// verifyStoredManifest reads the head of the finished object and validates its
// manifest like any other encrypted write: current generation, a signature by an
// active device of the uploader, and the binding to this attachment.
func verifyStoredManifest(ctx context.Context, q *sqlc.Queries, store objectstore.Store, attachment sqlc.Attachment) (*encFailure, error) {
	target := fileContext{
		projectID: attachment.ProjectID, workItemID: attachment.WorkItemID, conversationID: attachment.ConversationID,
	}
	domain, found, err := bodyDomain(ctx, q, target)
	if err != nil {
		return nil, err
	}
	var signer *pgtype.UUID
	if attachment.BodySignerDeviceID.Valid {
		signer = &attachment.BodySignerDeviceID
	}
	writer, failure, err := prepareEncryptedWith(ctx, q, attachment.UploaderID, domain, found, signer)
	if err != nil || failure != nil {
		return failure, err
	}
	head, err := store.ReadRange(ctx, attachment.ObjectKey, 0, int64(fileHeaderLength))
	if err != nil {
		return nil, err
	}
	if len(head) != fileHeaderLength || !bytes.HasPrefix(head, []byte(fileMagic)) || head[len(fileMagic)] != fileFormatVersion {
		return &encFailure{http.StatusBadRequest, gen.ApiErrorCodeBadEnvelope}, nil
	}
	return writer.verify(attachment.UploaderID, attachmentManifestResource(attachment.ID), 1, b64(head[len(fileMagic)+1:])), nil
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
