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
