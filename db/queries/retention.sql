-- name: PurgeOldSessions :execrows
DELETE FROM auth_session
WHERE (revoked_at IS NOT NULL AND revoked_at < now() - make_interval(days => sqlc.arg('days')::integer))
   OR expires_at < now() - make_interval(days => sqlc.arg('days')::integer);

-- name: PurgeOldPasswordResets :execrows
DELETE FROM password_reset WHERE created_at < now() - make_interval(days => sqlc.arg('days')::integer);

-- name: PurgeOldCalls :execrows
DELETE FROM call WHERE state = 'ended' AND ended_at < now() - make_interval(days => sqlc.arg('days')::integer);

-- name: PurgeOldWebhookEvents :execrows
DELETE FROM livekit_webhook_event WHERE received_at < now() - make_interval(days => sqlc.arg('days')::integer);

-- name: PurgeOldRecoveryAudit :execrows
DELETE FROM recovery_audit WHERE created_at < now() - make_interval(days => sqlc.arg('days')::integer);
