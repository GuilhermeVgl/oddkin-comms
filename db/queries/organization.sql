-- name: CreateOrganization :one
INSERT INTO organization (id, timezone)
VALUES ($1, $2)
RETURNING id, timezone, created_at;

-- name: GetOrganization :one
SELECT id, timezone, created_at
FROM organization
LIMIT 1;

-- name: GetOrganizationBranding :one
SELECT id, name, logo_data, show_duo
FROM organization
LIMIT 1;

-- name: GetOrganizationLogo :one
SELECT logo_data, logo_mime
FROM organization
LIMIT 1;

-- name: UpdateOrganizationBranding :exec
UPDATE organization
SET name = $1, show_duo = $2,
    logo_data = CASE WHEN sqlc.arg(logo_changed)::boolean THEN sqlc.narg(logo_data)::bytea ELSE logo_data END,
    logo_mime = CASE WHEN sqlc.arg(logo_changed)::boolean THEN sqlc.narg(logo_mime)::text ELSE logo_mime END
WHERE id = $3;
