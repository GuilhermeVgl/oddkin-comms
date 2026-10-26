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

-- name: ListOrganizationPeople :many
SELECT a.id, a.email_normalized, a.active, m.membership_kind, m.is_admin
FROM organization_membership AS m
JOIN account AS a ON a.id = m.account_id
WHERE m.organization_id = $1
ORDER BY a.email_normalized;

-- name: GetOrganizationPerson :one
SELECT a.id, a.active, m.membership_kind, m.is_admin
FROM organization_membership AS m
JOIN account AS a ON a.id = m.account_id
WHERE m.organization_id = $1 AND a.id = $2;

-- name: SetAccountActive :exec
UPDATE account SET active = $2 WHERE id = $1;

-- name: CountActiveAdmins :one
SELECT count(*)::integer
FROM organization_membership AS m
JOIN account AS a ON a.id = m.account_id
WHERE m.organization_id = $1 AND m.is_admin AND a.active;
