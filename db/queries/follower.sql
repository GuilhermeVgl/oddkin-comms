-- name: FollowWorkItem :exec
INSERT INTO work_item_follower (work_item_id, account_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: UnfollowWorkItem :exec
DELETE FROM work_item_follower WHERE work_item_id = $1 AND account_id = $2;

-- name: IsFollowingWorkItem :one
SELECT EXISTS (SELECT 1 FROM work_item_follower WHERE work_item_id = $1 AND account_id = $2);

-- name: ListWorkItemFollowers :many
SELECT account_id FROM work_item_follower WHERE work_item_id = $1;
