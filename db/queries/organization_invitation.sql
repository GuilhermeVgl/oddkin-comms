-- name: CreateOrganizationInvitation :one
INSERT INTO organization_invitation (organization_id, email_normalized, membership_kind, token_hash, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, organization_id, email_normalized, membership_kind, token_hash, expires_at, consumed_at, created_at;

-- name: ClaimOrganizationInvitation :one
UPDATE organization_invitation
SET consumed_at = clock_timestamp()
WHERE token_hash = sqlc.arg(token_hash)
  AND organization_invitation.email_normalized = sqlc.arg(email_normalized)
  AND consumed_at IS NULL AND expires_at > clock_timestamp()
RETURNING id, organization_id, email_normalized, membership_kind, token_hash, expires_at, consumed_at, created_at;
