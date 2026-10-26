-- name: ListCompletionDays :many
-- Days (in the organization's time zone) on which the person finished at least
-- one task assigned to them, newest first.
SELECT (w.completed_at AT TIME ZONE o.timezone)::date AS day, count(*)::integer AS finished
FROM work_item AS w
JOIN project AS p ON p.id = w.project_id
JOIN organization AS o ON o.id = p.organization_id
WHERE w.assignee_id = $1 AND w.kind = 'task' AND w.completed_at IS NOT NULL
GROUP BY 1
ORDER BY 1 DESC;

-- name: GetOrganizationTimezone :one
SELECT o.timezone FROM organization AS o
JOIN organization_membership AS m ON m.organization_id = o.id
WHERE m.account_id = $1
LIMIT 1;

-- name: GetGamificationCounts :one
SELECT
    (SELECT count(*) FROM work_item_kudos AS k JOIN work_item AS w ON w.id = k.work_item_id WHERE w.assignee_id = $1)::integer AS kudos_received,
    (SELECT count(*) FROM work_item_kudos WHERE from_account_id = $1)::integer AS kudos_given,
    (SELECT COALESCE(sum(minutes), 0) FROM focus_session WHERE account_id = $1)::integer AS focus_minutes,
    (SELECT count(DISTINCT call_id) FROM call_admission WHERE account_id = $1 AND joined_at IS NOT NULL)::integer AS calls_joined,
    (SELECT count(*) FROM work_item_comment WHERE author_id = $1)::integer AS comments_written,
    (SELECT count(*) FROM work_item WHERE assignee_id = $1 AND kind = 'task' AND completed_at IS NOT NULL)::integer AS completed_total;

-- name: GiveKudos :execrows
INSERT INTO work_item_kudos (work_item_id, from_account_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RemoveKudos :exec
DELETE FROM work_item_kudos WHERE work_item_id = $1 AND from_account_id = $2;

-- name: GetItemEngagement :one
SELECT
    (SELECT count(*) FROM work_item_kudos AS k WHERE k.work_item_id = sqlc.arg('item'))::integer AS kudos_count,
    EXISTS (SELECT 1 FROM work_item_kudos AS k WHERE k.work_item_id = sqlc.arg('item') AND k.from_account_id = sqlc.arg('me')) AS kudos_mine,
    (SELECT COALESCE(sum(f.minutes), 0) FROM focus_session AS f WHERE f.work_item_id = sqlc.arg('item'))::integer AS focus_minutes;

-- name: RecordFocusSession :exec
INSERT INTO focus_session (account_id, work_item_id, minutes) VALUES ($1, $2, $3);

-- name: IsWorkItemDone :one
SELECT w.completed_at IS NOT NULL FROM work_item AS w WHERE w.id = $1;
