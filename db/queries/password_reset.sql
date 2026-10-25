-- name: RevokePendingPasswordResets :exec
UPDATE password_reset
SET used_at = clock_timestamp(), token_ciphertext = NULL
WHERE account_id = $1 AND used_at IS NULL;

-- name: CreatePasswordReset :one
INSERT INTO password_reset (account_id, token_hash, token_ciphertext, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING id;

-- name: GetPasswordResetDelivery :one
SELECT r.id, r.token_ciphertext, a.email_normalized
FROM password_reset AS r
JOIN account AS a ON a.id = r.account_id
WHERE r.id = $1 AND r.used_at IS NULL AND r.sent_at IS NULL AND r.expires_at > clock_timestamp() AND a.active;

-- name: MarkPasswordResetSent :execrows
UPDATE password_reset SET sent_at = clock_timestamp(), token_ciphertext = NULL
WHERE id = $1 AND sent_at IS NULL;

-- name: ClaimPasswordReset :one
UPDATE password_reset
SET used_at = clock_timestamp(), token_ciphertext = NULL
WHERE token_hash = $1 AND used_at IS NULL AND expires_at > clock_timestamp()
RETURNING account_id;

-- name: SetAccountPassword :exec
UPDATE account SET password_hash = $2 WHERE id = $1;
