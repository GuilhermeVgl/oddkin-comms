-- name: UpsertAvatar :one
INSERT INTO account_avatar (account_id, content_type, data)
VALUES ($1, $2, $3)
ON CONFLICT (account_id) DO UPDATE
SET content_type = EXCLUDED.content_type, data = EXCLUDED.data,
    version = account_avatar.version + 1, updated_at = now()
RETURNING version;

-- name: DeleteAvatar :execrows
DELETE FROM account_avatar WHERE account_id = $1;

-- name: GetAvatar :one
SELECT content_type, data, version FROM account_avatar WHERE account_id = $1;

-- Photos the caller may see: their own, those of people who share a project
-- with them, and (for administrators) everyone in the organization.
-- name: ListVisibleAvatars :many
SELECT a.account_id, a.version
FROM account_avatar AS a
WHERE a.account_id = sqlc.arg('me')
   OR a.account_id IN (
        SELECT other.account_id
        FROM project_member AS mine
        JOIN project_member AS other ON other.project_id = mine.project_id
        WHERE mine.account_id = sqlc.arg('me'))
   OR (sqlc.arg('is_admin')::boolean AND a.account_id IN (
        SELECT account_id FROM organization_membership WHERE organization_id = sqlc.arg('organization_id')));

-- name: ListCoMembers :many
SELECT DISTINCT other.account_id
FROM project_member AS mine
JOIN project_member AS other ON other.project_id = mine.project_id
WHERE mine.account_id = $1;
