-- name: CreateAuthSession :one
INSERT INTO auth_session (account_id, token_hash, csrf_hash, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING id, account_id, token_hash, csrf_hash, created_at, last_seen_at, expires_at, revoked_at;

-- name: FindActiveSessionByTokenHash :one
SELECT s.id, s.account_id, s.csrf_hash, s.expires_at, a.email_normalized,
       m.membership_kind, m.is_admin
FROM auth_session AS s
JOIN account AS a ON a.id = s.account_id
JOIN organization_membership AS m ON m.account_id = a.id
WHERE s.token_hash = $1
  AND s.revoked_at IS NULL
  AND s.expires_at > clock_timestamp()
  AND s.last_seen_at > clock_timestamp() - interval '24 hours'
  AND a.active;

-- name: TouchAuthSession :execrows
UPDATE auth_session
SET last_seen_at = clock_timestamp()
WHERE id = $1
  AND last_seen_at < clock_timestamp() - interval '1 hour'
  AND last_seen_at > clock_timestamp() - interval '24 hours'
  AND expires_at > clock_timestamp()
  AND revoked_at IS NULL;

-- name: RevokeAuthSession :execrows
UPDATE auth_session SET revoked_at = clock_timestamp()
WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeAllAccountSessions :execrows
UPDATE auth_session SET revoked_at = clock_timestamp()
WHERE account_id = $1 AND revoked_at IS NULL;
