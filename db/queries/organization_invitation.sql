-- name: CreateOrganizationInvitation :one
INSERT INTO organization_invitation (organization_id, email_normalized, membership_kind, token_hash, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, organization_id, email_normalized, membership_kind, token_hash, expires_at, consumed_at, created_at;

-- name: ClaimOrganizationInvitation :one
UPDATE organization_invitation
SET consumed_at = clock_timestamp()
WHERE token_hash = sqlc.arg(token_hash)
  AND organization_invitation.email_normalized = sqlc.arg(email_normalized)
  AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > clock_timestamp()
RETURNING id, organization_id, email_normalized, membership_kind, token_hash, expires_at, consumed_at, created_at, requested_by, revoked_at;

-- name: CreateInvitationDelivery :exec
INSERT INTO invitation_delivery (invitation_id, token_ciphertext)
VALUES ($1, $2);

-- name: SetInvitationRequester :exec
UPDATE organization_invitation SET requested_by = $2 WHERE id = $1;

-- name: RevokePendingOrganizationInvitations :execrows
WITH revoked AS (
    UPDATE organization_invitation
    SET revoked_at = clock_timestamp()
    WHERE organization_id = $1 AND email_normalized = $2
      AND consumed_at IS NULL AND revoked_at IS NULL
    RETURNING id
)
UPDATE invitation_delivery
SET state = 'cancelled', token_ciphertext = '\x00', updated_at = clock_timestamp()
WHERE invitation_id IN (SELECT id FROM revoked) AND state = 'pending';

-- name: GetInvitationDelivery :one
SELECT i.id, i.email_normalized, i.membership_kind, i.expires_at, d.token_ciphertext, d.state
FROM organization_invitation AS i
JOIN invitation_delivery AS d ON d.invitation_id = i.id
WHERE i.id = $1 AND i.revoked_at IS NULL AND i.consumed_at IS NULL AND i.expires_at > clock_timestamp();

-- name: MarkInvitationDeliverySent :execrows
UPDATE invitation_delivery
SET state = 'sent', provider_id = $2, sent_at = clock_timestamp(),
    token_ciphertext = '\x00', updated_at = clock_timestamp()
WHERE invitation_id = $1 AND state = 'pending';

-- name: MarkInvitationDeliveryFailed :execrows
UPDATE invitation_delivery
SET state = 'failed', updated_at = clock_timestamp()
WHERE invitation_id = $1 AND state = 'pending';

-- name: ClearInvitationDeliveryToken :exec
UPDATE invitation_delivery
SET token_ciphertext = '\x00', updated_at = clock_timestamp()
WHERE invitation_id = $1;
