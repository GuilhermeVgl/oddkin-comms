-- name: CreateOrganization :one
INSERT INTO organization (id, timezone)
VALUES ($1, $2)
RETURNING id, timezone, created_at;

-- name: GetOrganization :one
SELECT id, timezone, created_at
FROM organization
LIMIT 1;
