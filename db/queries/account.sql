-- name: CreateAccount :one
INSERT INTO account (email_normalized, password_hash)
VALUES ($1, $2)
RETURNING id, email_normalized, password_hash, active, created_at;

-- name: GetAccountByEmail :one
SELECT id, email_normalized, password_hash, active, created_at
FROM account
WHERE email_normalized = $1;

-- name: CreateOrganizationMembership :one
INSERT INTO organization_membership (organization_id, account_id, membership_kind, is_admin)
VALUES ($1, $2, $3, $4)
RETURNING organization_id, account_id, membership_kind, is_admin, created_at;

-- name: GetOrganizationMembershipForAccount :one
SELECT organization_id, membership_kind, is_admin
FROM organization_membership
WHERE account_id = $1;

-- name: EnsureOrganizationMembership :one
INSERT INTO organization_membership (organization_id, account_id, membership_kind, is_admin)
VALUES ($1, $2, $3, false)
ON CONFLICT (organization_id, account_id) DO UPDATE
SET membership_kind = organization_membership.membership_kind
WHERE organization_membership.membership_kind = EXCLUDED.membership_kind
RETURNING organization_id, account_id, membership_kind, is_admin, created_at;
