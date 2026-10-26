-- name: CreateProject :one
INSERT INTO project (organization_id, name, description, color, icon, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: AddProjectMember :exec
INSERT INTO project_member (project_id, account_id, is_manager)
VALUES ($1, $2, $3)
ON CONFLICT (project_id, account_id) DO UPDATE SET is_manager = project_member.is_manager OR EXCLUDED.is_manager;

-- name: CreateExternalProjectPolicy :exec
INSERT INTO external_project_policy (project_id) VALUES ($1);

-- name: CreateBoardColumn :one
INSERT INTO board_column (project_id, name, position, category)
VALUES ($1, $2, $3, $4)
RETURNING id, project_id, name, position, category;

-- name: ListBoardColumns :many
SELECT id, project_id, name, position, category
FROM board_column
WHERE project_id = $1
ORDER BY position, id;

-- name: LockProject :exec
SELECT id FROM project WHERE id = $1 FOR UPDATE;

-- name: UpdateBoardColumn :one
UPDATE board_column
SET name = COALESCE(sqlc.narg('name')::text, name),
    category = COALESCE(sqlc.narg('category')::text, category)
WHERE id = $1 AND project_id = $2
RETURNING id, project_id, name, position, category;

-- name: SetBoardColumnPosition :exec
UPDATE board_column SET position = $3 WHERE id = $1 AND project_id = $2;

-- name: CountWorkItemsInColumn :one
SELECT count(*)::integer FROM work_item WHERE column_id = $1 AND project_id = $2;

-- name: MoveWorkItemsBetweenColumns :exec
UPDATE work_item
SET column_id = $3, version = version + 1, updated_at = now()
WHERE column_id = $1 AND project_id = $2;

-- name: DeleteBoardColumn :execrows
DELETE FROM board_column WHERE id = $1 AND project_id = $2;

-- name: NextBoardColumnPosition :one
SELECT COALESCE(max(position) + 1, 0)::integer AS position
FROM board_column
WHERE project_id = $1;

-- name: GetProjectAccess :one
SELECT p.id AS project_id, p.archived, pm.is_manager, om.membership_kind, om.is_admin,
       COALESCE(ep.permissions, ARRAY[]::text[])::text[] AS external_permissions
FROM project AS p
JOIN project_member AS pm ON pm.project_id = p.id AND pm.account_id = $2
JOIN organization_membership AS om ON om.organization_id = p.organization_id AND om.account_id = pm.account_id
LEFT JOIN external_project_policy AS ep ON ep.project_id = p.id
WHERE p.id = $1;

-- name: ListProjectsForAccount :many
SELECT p.*, pm.is_manager, om.membership_kind,
       COALESCE(ep.permissions, ARRAY[]::text[])::text[] AS external_permissions
FROM project AS p
JOIN project_member AS pm ON pm.project_id = p.id
JOIN organization_membership AS om ON om.organization_id = p.organization_id AND om.account_id = pm.account_id
LEFT JOIN external_project_policy AS ep ON ep.project_id = p.id
WHERE pm.account_id = sqlc.arg('account_id') AND (NOT p.archived OR sqlc.arg('include_archived')::boolean)
ORDER BY p.created_at, p.id;

-- name: UpdateProjectColor :exec
UPDATE project SET color = $2, version = version + 1 WHERE id = $1;

-- name: GetProject :one
SELECT * FROM project WHERE id = $1;

-- name: RemoveProjectMember :execrows
DELETE FROM project_member WHERE project_id = $1 AND account_id = $2;

-- name: CountProjectManagers :one
SELECT count(*)::integer FROM project_member WHERE project_id = $1 AND is_manager;

-- name: ListProjectMembers :many
SELECT pm.account_id, a.email_normalized, om.membership_kind, pm.is_manager
FROM project_member AS pm
JOIN account AS a ON a.id = pm.account_id
JOIN project AS p ON p.id = pm.project_id
JOIN organization_membership AS om ON om.organization_id = p.organization_id AND om.account_id = pm.account_id
WHERE pm.project_id = $1
ORDER BY a.email_normalized;

-- name: FindOrganizationMemberByEmail :one
SELECT a.id AS account_id, om.membership_kind
FROM account AS a
JOIN organization_membership AS om ON om.account_id = a.id
JOIN project AS p ON p.organization_id = om.organization_id
WHERE p.id = $1 AND a.email_normalized = $2 AND a.active;

-- name: GetExternalProjectPolicy :one
SELECT project_id, permissions, version
FROM external_project_policy
WHERE project_id = $1;

-- name: UpdateExternalProjectPolicy :one
UPDATE external_project_policy
SET permissions = $2, version = version + 1, updated_at = now()
WHERE project_id = $1 AND version = $3
RETURNING project_id, permissions, version;

-- name: CreateWorkItem :one
INSERT INTO work_item (project_id, kind, parent_id, title, description, assignee_id, due_date, priority, column_id, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: ListWorkItems :many
SELECT *
FROM work_item
WHERE project_id = $1 AND NOT archived
ORDER BY created_at, id;

-- name: GetWorkItemForUpdate :one
SELECT *
FROM work_item
WHERE id = $1
FOR UPDATE;

-- name: GetWorkItem :one
SELECT *
FROM work_item
WHERE id = $1;

-- name: UpdateWorkItem :one
UPDATE work_item
SET title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    priority = COALESCE(sqlc.narg('priority'), priority),
    column_id = COALESCE(sqlc.narg('column_id'), column_id),
    archived = COALESCE(sqlc.narg('archived'), archived),
    assignee_id = CASE WHEN sqlc.arg('set_assignee')::boolean THEN sqlc.narg('assignee_id') ELSE assignee_id END,
    due_date = CASE WHEN sqlc.arg('set_due_date')::boolean THEN sqlc.narg('due_date') ELSE due_date END,
    epic_id = CASE WHEN sqlc.arg('set_epic')::boolean THEN sqlc.narg('epic_id') ELSE epic_id END,
    sprint_id = CASE WHEN sqlc.arg('set_sprint')::boolean THEN sqlc.narg('sprint_id') ELSE sprint_id END,
    version = version + 1,
    updated_at = now()
WHERE id = sqlc.arg('id') AND version = sqlc.arg('version')
RETURNING *;

-- name: ListOpenSubtasks :many
SELECT w.id
FROM work_item AS w
JOIN board_column AS c ON c.id = w.column_id
WHERE w.parent_id = $1 AND NOT w.archived AND c.category <> 'done'
FOR UPDATE OF w;

-- name: MoveWorkItemToColumn :exec
UPDATE work_item
SET column_id = $2, version = version + 1, updated_at = now()
WHERE id = $1;

-- name: GetBoardColumn :one
SELECT id, project_id, name, position, category
FROM board_column
WHERE id = $1 AND project_id = $2;

-- name: FirstColumnForReopen :one
SELECT id
FROM board_column
WHERE project_id = $1 AND category <> 'done'
ORDER BY (category = 'in_progress') DESC, position, id
LIMIT 1;

-- name: CreateWorkItemComment :one
INSERT INTO work_item_comment (work_item_id, author_id, body)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListWorkItemComments :many
SELECT c.id, c.work_item_id, c.author_id, a.email_normalized AS author_email, c.body, c.created_at,
       c.encrypted, c.body_enc, c.content_signer_device_id
FROM work_item_comment AS c
LEFT JOIN account AS a ON a.id = c.author_id
WHERE c.work_item_id = $1
ORDER BY c.created_at, c.id;

-- name: CreateConversation :one
INSERT INTO conversation (project_id, name, position)
VALUES ($1, $2, (SELECT COALESCE(max(position) + 1, 0) FROM conversation WHERE project_id = $1 AND kind = 'channel'))
RETURNING *;

-- name: CreateEncryptedConversation :one
INSERT INTO conversation (id, project_id, name, encrypted, name_enc, content_revision, content_author_id, content_signer_device_id, position)
VALUES ($1, $2, '', true, $3, 1, $4, $5, (SELECT COALESCE(max(position) + 1, 0) FROM conversation WHERE project_id = $2 AND kind = 'channel'))
RETURNING *;

-- name: SetConversationName :execrows
UPDATE conversation SET name = $2 WHERE id = $1 AND kind = 'channel' AND NOT encrypted;

-- name: SetConversationArchived :execrows
UPDATE conversation SET archived = $2 WHERE id = $1 AND kind = 'channel';

-- name: SetConversationPosition :exec
UPDATE conversation SET position = $3 WHERE id = $1 AND project_id = $2 AND kind = 'channel';

-- name: ListChannelIDs :many
SELECT id FROM conversation WHERE project_id = $1 AND kind = 'channel' ORDER BY position, created_at, id;

-- name: SetProjectArchived :exec
UPDATE project SET archived = $2, version = version + 1 WHERE id = $1;

-- name: ListConversations :many
SELECT c.*, GREATEST(c.last_seq - COALESCE(r.last_seq, 0), 0)::bigint AS unread
FROM conversation AS c
LEFT JOIN conversation_read_cursor AS r ON r.conversation_id = c.id AND r.account_id = sqlc.arg('account_id')
WHERE c.project_id = sqlc.arg('project_id') AND c.kind = 'channel'
ORDER BY c.position, c.created_at, c.id;

-- name: GetConversation :one
SELECT *
FROM conversation
WHERE id = $1;

-- name: NextMessageSeq :one
UPDATE conversation SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq;

-- name: CreateMessage :one
INSERT INTO message (conversation_id, seq, author_id, body, client_mutation_id, reply_to_id)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: FindMessageByMutation :one
SELECT *
FROM message
WHERE conversation_id = $1 AND author_id = $2 AND client_mutation_id = $3;

-- name: ListMessages :many
SELECT m.id, m.seq, m.body, m.created_at, m.reply_to_id, m.edited_at, m.deleted_at, m.encrypted, m.body_enc, m.content_revision,
       m.content_signer_device_id, m.author_id, m.client_mutation_id, COALESCE(a.email_normalized, '')::text AS author_email
FROM message AS m
LEFT JOIN account AS a ON a.id = m.author_id
WHERE m.conversation_id = $1 AND m.seq > $2
ORDER BY m.seq
LIMIT $3;

-- name: LockConversation :one
SELECT *
FROM conversation
WHERE id = $1
FOR UPDATE;

-- name: CreateEpic :one
INSERT INTO epic (project_id, title, description, created_by)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListEpics :many
SELECT * FROM epic WHERE project_id = $1 ORDER BY created_at, id;

-- name: GetEpicForUpdate :one
SELECT * FROM epic WHERE id = $1 FOR UPDATE;

-- name: UpdateEpic :one
UPDATE epic
SET title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    done = COALESCE(sqlc.narg('done'), done),
    version = version + 1
WHERE id = sqlc.arg('id') AND version = sqlc.arg('version')
RETURNING *;

-- name: CountOpenEpicTasks :one
SELECT count(*)::integer
FROM work_item AS w
JOIN board_column AS c ON c.id = w.column_id
WHERE w.epic_id = $1 AND NOT w.archived AND c.category <> 'done';

-- name: ReopenEpic :exec
UPDATE epic SET done = false, version = version + 1 WHERE id = $1 AND done;

-- name: CreateSprint :one
INSERT INTO sprint (organization_id, name, goal, starts_on, ends_on, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListSprintsForAccount :many
SELECT s.*
FROM sprint AS s
JOIN organization_membership AS om ON om.organization_id = s.organization_id AND om.account_id = $1
WHERE om.membership_kind = 'internal'
   OR EXISTS (
        SELECT 1
        FROM work_item AS w
        JOIN project_member AS pm ON pm.project_id = w.project_id AND pm.account_id = $1
        JOIN external_project_policy AS ep ON ep.project_id = w.project_id
        WHERE w.sprint_id = s.id AND NOT w.archived AND 'work.read' = ANY (ep.permissions)
   )
ORDER BY (s.state = 'active') DESC, s.starts_on DESC, s.id;

-- name: GetSprintForUpdate :one
SELECT * FROM sprint WHERE id = $1 FOR UPDATE;

-- name: GetSprint :one
SELECT * FROM sprint WHERE id = $1;

-- name: StartSprint :one
UPDATE sprint SET state = 'active', version = version + 1
WHERE id = $1 AND state = 'planned'
RETURNING *;

-- name: CloseSprint :exec
UPDATE sprint SET state = 'closed', closed_at = now(), version = version + 1 WHERE id = $1;

-- name: ListSprintTasksForAccount :many
SELECT w.*
FROM work_item AS w
JOIN project AS p ON p.id = w.project_id
JOIN project_member AS pm ON pm.project_id = w.project_id AND pm.account_id = $2
JOIN organization_membership AS om ON om.organization_id = p.organization_id AND om.account_id = pm.account_id
LEFT JOIN external_project_policy AS ep ON ep.project_id = w.project_id
WHERE w.sprint_id = $1 AND NOT w.archived
  AND (om.membership_kind = 'internal' OR 'work.read' = ANY (COALESCE(ep.permissions, ARRAY[]::text[])))
ORDER BY w.created_at, w.id;

-- name: ListSprintTasksForClose :many
SELECT w.id, w.project_id, w.version, (c.category = 'done')::boolean AS finished,
       EXISTS (
           SELECT 1 FROM project_member AS pm
           JOIN organization_membership AS om ON om.account_id = pm.account_id
           JOIN project AS p ON p.id = pm.project_id AND p.organization_id = om.organization_id
           WHERE pm.project_id = w.project_id AND pm.account_id = $2 AND om.membership_kind = 'internal'
       )::boolean AS accessible
FROM work_item AS w
JOIN board_column AS c ON c.id = w.column_id
WHERE w.sprint_id = $1 AND NOT w.archived
ORDER BY w.id
FOR UPDATE OF w;

-- name: SetTaskSprint :exec
UPDATE work_item SET sprint_id = $2, version = version + 1, updated_at = now() WHERE id = $1;

-- name: RecordSprintItem :exec
INSERT INTO sprint_item_history (sprint_id, work_item_id, outcome) VALUES ($1, $2, $3);

-- name: GetProjectOrganization :one
SELECT organization_id FROM project WHERE id = $1;

-- name: DirectMessagesAllowed :one
SELECT EXISTS (
    SELECT 1
    FROM project AS p
    JOIN project_member AS pa ON pa.project_id = p.id AND pa.account_id = sqlc.arg('first')
    JOIN project_member AS pb ON pb.project_id = p.id AND pb.account_id = sqlc.arg('second')
    JOIN organization_membership AS oa ON oa.organization_id = p.organization_id AND oa.account_id = pa.account_id
    JOIN organization_membership AS ob ON ob.organization_id = p.organization_id AND ob.account_id = pb.account_id
    LEFT JOIN external_project_policy AS ep ON ep.project_id = p.id
    WHERE NOT p.archived
      AND (oa.membership_kind = 'internal' OR 'direct_messages.use' = ANY (COALESCE(ep.permissions, ARRAY[]::text[])))
      AND (ob.membership_kind = 'internal' OR 'direct_messages.use' = ANY (COALESCE(ep.permissions, ARRAY[]::text[])))
)::boolean AS allowed;

-- name: ListDirectContacts :many
SELECT DISTINCT a.id AS account_id, a.email_normalized
FROM project AS p
JOIN project_member AS pa ON pa.project_id = p.id AND pa.account_id = $1
JOIN project_member AS pb ON pb.project_id = p.id AND pb.account_id <> $1
JOIN account AS a ON a.id = pb.account_id AND a.active
JOIN organization_membership AS oa ON oa.organization_id = p.organization_id AND oa.account_id = pa.account_id
JOIN organization_membership AS ob ON ob.organization_id = p.organization_id AND ob.account_id = pb.account_id
LEFT JOIN external_project_policy AS ep ON ep.project_id = p.id
WHERE NOT p.archived
  AND (oa.membership_kind = 'internal' OR 'direct_messages.use' = ANY (COALESCE(ep.permissions, ARRAY[]::text[])))
  AND (ob.membership_kind = 'internal' OR 'direct_messages.use' = ANY (COALESCE(ep.permissions, ARRAY[]::text[])))
ORDER BY a.email_normalized;

-- name: EnsureDirectConversation :one
INSERT INTO conversation (kind, name, dm_low, dm_high)
VALUES ('dm', 'dm', $1, $2)
ON CONFLICT (dm_low, dm_high) WHERE kind = 'dm' DO UPDATE SET name = conversation.name
RETURNING id, (xmax = 0)::boolean AS created;

-- name: ListDirectConversations :many
SELECT c.id, peer.id AS peer_id, peer.email_normalized AS peer_email,
       GREATEST(c.last_seq - COALESCE(r.last_seq, 0), 0)::bigint AS unread
FROM conversation AS c
LEFT JOIN conversation_read_cursor AS r ON r.conversation_id = c.id AND r.account_id = $1
JOIN account AS peer ON peer.id = CASE WHEN c.dm_low = $1 THEN c.dm_high ELSE c.dm_low END
WHERE c.kind = 'dm' AND (c.dm_low = $1 OR c.dm_high = $1)
ORDER BY peer.email_normalized;

-- name: GetMessageForUpdate :one
SELECT * FROM message WHERE id = $1 FOR UPDATE;

-- name: EditMessage :one
UPDATE message SET body = $2, edited_at = now() WHERE id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: DeleteMessage :exec
UPDATE message SET body = '', body_enc = NULL, deleted_at = now() WHERE id = $1;

-- name: DeleteMessageReactions :exec
DELETE FROM message_reaction WHERE message_id = $1;

-- name: AddReaction :execrows
INSERT INTO message_reaction (message_id, account_id, emoji) VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: RemoveReaction :execrows
DELETE FROM message_reaction WHERE message_id = $1 AND account_id = $2 AND emoji = $3;

-- name: ListReactions :many
SELECT message_id, emoji, count(*)::integer AS total, bool_or(account_id = sqlc.arg('me'))::boolean AS mine
FROM message_reaction
WHERE message_id = ANY (sqlc.arg('ids')::uuid[])
GROUP BY message_id, emoji
ORDER BY message_id, min(created_at);

-- name: GetAccountByID :one
SELECT id, email_normalized FROM account WHERE id = $1 AND active;

-- name: NextUserEventSeq :one
INSERT INTO user_event_cursor (account_id, last_seq) VALUES ($1, 1)
ON CONFLICT (account_id) DO UPDATE SET last_seq = user_event_cursor.last_seq + 1
RETURNING last_seq;

-- name: InsertUserEvent :exec
INSERT INTO user_event (account_id, seq, event_id, type, resource_id, resource_version, project_id, conversation_id, required_permission)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: ListUserEvents :many
SELECT * FROM user_event WHERE account_id = $1 AND seq > $2 ORDER BY seq LIMIT $3;

-- name: UserEventHead :one
SELECT COALESCE((SELECT last_seq FROM user_event_cursor WHERE account_id = $1), 0)::bigint AS head;

-- name: OldestUserEventSeq :one
SELECT COALESCE(min(seq), 0)::bigint AS oldest FROM user_event WHERE account_id = $1;

-- name: PruneUserEvents :execrows
DELETE FROM user_event WHERE occurred_at < now() - interval '7 days';

-- name: ProjectRecipients :many
SELECT pm.account_id
FROM project_member AS pm
JOIN project AS p ON p.id = pm.project_id
JOIN organization_membership AS om ON om.organization_id = p.organization_id AND om.account_id = pm.account_id
JOIN account AS a ON a.id = pm.account_id AND a.active
LEFT JOIN external_project_policy AS ep ON ep.project_id = p.id
WHERE pm.project_id = sqlc.arg('project_id')
  AND (sqlc.arg('permission')::text = ''
       OR om.membership_kind = 'internal'
       OR sqlc.arg('permission')::text = ANY (COALESCE(ep.permissions, ARRAY[]::text[])))
ORDER BY pm.account_id;

-- name: CreateNotification :one
INSERT INTO notification (account_id, kind, resource_id, project_id, conversation_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListNotifications :many
SELECT * FROM notification WHERE account_id = $1 ORDER BY created_at DESC, id LIMIT 100;

-- name: MarkNotificationRead :execrows
UPDATE notification SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND account_id = $2;

-- name: MarkAllNotificationsRead :exec
UPDATE notification SET read_at = now() WHERE account_id = $1 AND read_at IS NULL;

-- name: SetReadCursor :exec
INSERT INTO conversation_read_cursor (account_id, conversation_id, last_seq)
VALUES ($1, $2, LEAST(sqlc.arg('seq')::bigint, (SELECT last_seq FROM conversation WHERE id = $2)))
ON CONFLICT (account_id, conversation_id)
DO UPDATE SET last_seq = GREATEST(conversation_read_cursor.last_seq, EXCLUDED.last_seq);

-- name: LockOrganization :exec
SELECT id FROM organization WHERE id = $1 FOR UPDATE;

-- name: ReservedStorage :one
SELECT COALESCE(sum(declared_size), 0)::bigint AS reserved
FROM attachment
WHERE organization_id = $1 AND state IN ('uploading', 'ready');

-- name: CreateAttachment :one
INSERT INTO attachment (id, organization_id, project_id, work_item_id, conversation_id, uploader_id, object_key, upload_id,
                        name, encrypted, name_enc, content_author_id, content_signer_device_id, content_type, declared_size, part_size, part_count,
                        body_encrypted, body_signer_device_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
RETURNING *;

-- name: SetAttachmentUploadID :exec
UPDATE attachment SET upload_id = $2 WHERE id = $1 AND state = 'uploading';

-- name: GetAttachment :one
SELECT * FROM attachment WHERE id = $1;

-- name: GetAttachmentForUpdate :one
SELECT * FROM attachment WHERE id = $1 FOR UPDATE;

-- name: MarkAttachmentReady :execrows
UPDATE attachment SET state = 'ready', stored_size = $2, ready_at = now() WHERE id = $1 AND state = 'uploading';

-- name: MarkAttachmentReleased :exec
UPDATE attachment SET state = $2, object_removed = false, released_at = now() WHERE id = $1 AND state IN ('uploading', 'ready');

-- name: MarkAttachmentObjectRemoved :exec
UPDATE attachment SET object_removed = true WHERE id = $1;

-- name: ListWorkItemAttachments :many
SELECT a.*, COALESCE(u.email_normalized, '')::text AS uploader_email
FROM attachment AS a
LEFT JOIN account AS u ON u.id = a.uploader_id
WHERE a.work_item_id = $1 AND a.state = 'ready'
ORDER BY a.created_at, a.id;

-- name: ListConversationAttachments :many
SELECT a.*, COALESCE(u.email_normalized, '')::text AS uploader_email
FROM attachment AS a
LEFT JOIN account AS u ON u.id = a.uploader_id
WHERE a.conversation_id = $1 AND a.state = 'ready'
ORDER BY a.created_at, a.id;

-- name: AbandonExpiredUploads :many
UPDATE attachment SET state = 'aborted', object_removed = false
WHERE state = 'uploading' AND created_at < now() - interval '24 hours'
RETURNING id;

-- name: ListPendingRelease :many
SELECT * FROM attachment
WHERE NOT object_removed
  AND (state = 'aborted' OR (state = 'deleted' AND released_at < now() - interval '30 days'))
ORDER BY created_at
LIMIT 100;

-- name: CreateCall :one
INSERT INTO call (conversation_id, started_by, room_name) VALUES ($1, $2, $3) RETURNING *;

-- name: GetCall :one
SELECT * FROM call WHERE id = $1;

-- name: GetCallByRoom :one
SELECT * FROM call WHERE room_name = $1;

-- name: LockCall :one
SELECT * FROM call WHERE id = $1 FOR UPDATE;

-- name: ActiveCallForConversation :one
SELECT * FROM call WHERE conversation_id = $1 AND state = 'active';

-- name: ListActiveCalls :many
SELECT * FROM call WHERE state = 'active' ORDER BY created_at;

-- name: EndCall :execrows
UPDATE call SET state = 'ended', ended_at = now(), ended_reason = $2, screen_sharer_id = NULL
WHERE id = $1 AND state = 'active';

-- name: AcquireScreenShare :execrows
UPDATE call SET screen_sharer_id = $2
WHERE id = $1 AND state = 'active' AND (screen_sharer_id IS NULL OR screen_sharer_id = $2);

-- name: ReleaseScreenShare :exec
UPDATE call SET screen_sharer_id = NULL WHERE id = $1 AND screen_sharer_id = $2;

-- name: UpsertCallInvitation :exec
INSERT INTO call_invitation (call_id, account_id) VALUES ($1, $2)
ON CONFLICT (call_id, account_id) DO UPDATE SET state = 'pending', responded_at = NULL
WHERE call_invitation.state IN ('declined', 'cancelled');

-- name: SetCallInvitationState :execrows
UPDATE call_invitation SET state = $3, responded_at = now()
WHERE call_id = $1 AND account_id = $2 AND state IN ('pending', 'accepted');

-- name: GetCallInvitation :one
SELECT * FROM call_invitation WHERE call_id = $1 AND account_id = $2;

-- name: ListCallInvitations :many
SELECT i.call_id, i.account_id, i.state, a.email_normalized
FROM call_invitation AS i JOIN account AS a ON a.id = i.account_id
WHERE i.call_id = $1 ORDER BY a.email_normalized;

-- name: CancelPendingCallInvitations :exec
UPDATE call_invitation SET state = 'cancelled', responded_at = now() WHERE call_id = $1 AND state = 'pending';

-- name: ListCallRecords :many
-- The conversation's call history, newest first: who started each call and who
-- actually joined it (a seat that was only reserved does not count).
SELECT c.id, c.state, c.created_at, c.ended_at, c.ended_reason, c.started_by,
       COALESCE(s.email_normalized, '')::text AS started_by_email,
       COALESCE((
           SELECT array_agg(DISTINCT a.email_normalized ORDER BY a.email_normalized)
           FROM call_admission AS ad JOIN account AS a ON a.id = ad.account_id
           WHERE ad.call_id = c.id AND ad.joined_at IS NOT NULL
       ), '{}')::text[] AS participant_emails
FROM call AS c LEFT JOIN account AS s ON s.id = c.started_by
WHERE c.conversation_id = $1
ORDER BY c.created_at DESC
LIMIT $2;

-- name: ListPendingCallInvitations :many
SELECT c.id AS call_id, c.conversation_id, c.created_at, c.started_by, COALESCE(s.email_normalized, '')::text AS started_by_email
FROM call_invitation AS i
JOIN call AS c ON c.id = i.call_id AND c.state = 'active'
LEFT JOIN account AS s ON s.id = c.started_by
WHERE i.account_id = $1 AND i.state = 'pending'
ORDER BY c.created_at DESC;

-- name: ExpireStaleAdmissionsForAccount :exec
UPDATE call_admission SET state = 'expired'
WHERE account_id = $1 AND state = 'reserved' AND reserved_until < now();

-- name: ExpireStaleAdmissionsForCall :exec
UPDATE call_admission SET state = 'expired'
WHERE call_id = $1 AND state = 'reserved' AND reserved_until < now();

-- name: CountCallSeats :one
SELECT count(*)::integer FROM call_admission
WHERE call_id = $1 AND state IN ('reserved', 'joined');

-- name: ActiveAdmissionForAccount :one
SELECT * FROM call_admission WHERE account_id = $1 AND state IN ('reserved', 'joined');

-- name: InsertAdmission :one
INSERT INTO call_admission (call_id, account_id, session_id, device_id, reserved_until)
VALUES ($1, $2, $3, $4, now() + make_interval(secs => sqlc.arg('seconds')::double precision))
RETURNING *;

-- name: RenewAdmission :one
UPDATE call_admission SET session_id = $2, device_id = $3, reserved_until = now() + make_interval(secs => sqlc.arg('seconds')::double precision)
WHERE id = $1 AND state IN ('reserved', 'joined')
RETURNING *;

-- name: ListCallParticipants :many
SELECT ad.account_id, a.email_normalized, ad.state, ad.joined_at
FROM call_admission AS ad JOIN account AS a ON a.id = ad.account_id
WHERE ad.call_id = $1 AND ad.state IN ('reserved', 'joined')
ORDER BY ad.created_at, ad.id;

-- name: MarkParticipantJoined :execrows
UPDATE call_admission SET state = 'joined', joined_at = COALESCE(joined_at, now())
WHERE call_id = $1 AND account_id = $2 AND state IN ('reserved', 'expired');

-- name: MarkParticipantLeft :execrows
UPDATE call_admission SET state = 'left', left_at = now()
WHERE call_id = $1 AND account_id = $2 AND state IN ('reserved', 'joined');

-- name: ReleaseCallAdmissions :exec
UPDATE call_admission SET state = 'left', left_at = now() WHERE call_id = $1 AND state IN ('reserved', 'joined');

-- name: ListCallAdmissionsForReconcile :many
SELECT account_id, state, joined_at, reserved_until FROM call_admission
WHERE call_id = $1 AND state IN ('reserved', 'joined');

-- name: RecordWebhookEvent :execrows
INSERT INTO livekit_webhook_event (event_id) VALUES ($1) ON CONFLICT DO NOTHING;

-- name: GetLatestAdmission :one
SELECT * FROM call_admission WHERE call_id = $1 AND account_id = $2 ORDER BY created_at DESC LIMIT 1;

-- name: SetTrustRoot :execrows
INSERT INTO organization_trust (organization_id, root_sign_public_key, set_by) VALUES ($1, $2, $3)
ON CONFLICT (organization_id) DO NOTHING;

-- name: GetTrustRoot :one
SELECT * FROM organization_trust WHERE organization_id = $1;

-- name: CreateDevice :one
INSERT INTO device (organization_id, account_id, kind, name, sign_public_key, box_public_key, proof)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetDevice :one
SELECT * FROM device WHERE id = $1;

-- name: ListDevicesForAccount :many
SELECT * FROM device WHERE account_id = $1 AND state <> 'revoked' ORDER BY created_at, id;

-- name: ListPendingDevices :many
SELECT d.*, a.email_normalized
FROM device AS d JOIN account AS a ON a.id = d.account_id
WHERE d.organization_id = $1 AND d.state = 'pending'
ORDER BY d.created_at, d.id;

-- name: ActivateDevice :execrows
UPDATE device SET state = 'active', certificate = $2, authorizer_device_id = $3, authorized_at = now()
WHERE id = $1 AND state = 'pending';

-- name: RevokeDevice :execrows
UPDATE device SET state = 'revoked', revoked_at = now() WHERE id = $1 AND state <> 'revoked';

-- name: ListActiveDevicesForAccounts :many
SELECT d.*, a.email_normalized
FROM device AS d JOIN account AS a ON a.id = d.account_id
WHERE d.account_id = ANY (sqlc.arg('accounts')::uuid[]) AND d.state = 'active' AND d.kind = 'device'
ORDER BY a.email_normalized, d.created_at, d.id;

-- name: ListActiveRecoveryDevices :many
SELECT d.*, a.email_normalized
FROM device AS d JOIN account AS a ON a.id = d.account_id
WHERE d.organization_id = $1 AND d.state = 'active' AND d.kind = 'recovery'
ORDER BY d.created_at, d.id;

-- name: CreateKeyDomain :one
INSERT INTO key_domain (organization_id, project_id, kind) VALUES ($1, $2, $3) RETURNING *;

-- name: GetKeyDomain :one
SELECT * FROM key_domain WHERE id = $1;

-- name: LockKeyDomain :one
SELECT * FROM key_domain WHERE id = $1 FOR UPDATE;

-- name: ListKeyDomainsForProject :many
SELECT * FROM key_domain WHERE project_id = $1 ORDER BY kind;

-- name: ListKeyDomainsForAccount :many
SELECT kd.id, kd.organization_id, kd.project_id, kd.kind, kd.current_generation, kd.state, kd.created_at, kd.conversation_id
FROM key_domain AS kd JOIN project_member AS pm ON pm.project_id = kd.project_id
WHERE pm.account_id = $1
UNION
SELECT kd.id, kd.organization_id, kd.project_id, kd.kind, kd.current_generation, kd.state, kd.created_at, kd.conversation_id
FROM key_domain AS kd JOIN conversation AS c ON c.id = kd.conversation_id
WHERE c.dm_low = $1 OR c.dm_high = $1
UNION
SELECT kd.id, kd.organization_id, kd.project_id, kd.kind, kd.current_generation, kd.state, kd.created_at, kd.conversation_id
FROM key_domain AS kd JOIN organization_membership AS om ON om.organization_id = kd.organization_id
WHERE kd.kind = 'sprint' AND om.account_id = $1 AND om.membership_kind = 'internal'
ORDER BY created_at, id;

-- name: SetKeyDomainState :exec
UPDATE key_domain SET state = $2 WHERE id = $1;

-- name: AdvanceKeyDomain :exec
UPDATE key_domain SET current_generation = $2, state = 'ok' WHERE id = $1;

-- name: InsertKeyGeneration :exec
INSERT INTO key_generation (domain_id, generation, created_by_device) VALUES ($1, $2, $3);

-- name: InsertKeyEnvelope :exec
INSERT INTO key_envelope (domain_id, generation, recipient_device_id, signer_device_id, sealed, signature)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: ListEnvelopeRecipients :many
SELECT recipient_device_id FROM key_envelope WHERE domain_id = $1 AND generation = $2;

-- name: ListEnvelopesForDevices :many
SELECT * FROM key_envelope
WHERE domain_id = $1 AND recipient_device_id = ANY (sqlc.arg('devices')::uuid[])
ORDER BY generation, recipient_device_id;

-- name: ListKeyDomainsForOrganization :many
SELECT * FROM key_domain WHERE organization_id = $1 ORDER BY created_at, id;

-- name: GetKeyDomainByProjectKind :one
SELECT * FROM key_domain WHERE project_id = $1 AND kind = $2;

-- name: ListAllEnvelopeRecipients :many
SELECT generation, recipient_device_id FROM key_envelope WHERE domain_id = $1 ORDER BY generation, recipient_device_id;

-- name: CreateEncryptedWorkItem :one
INSERT INTO work_item (id, project_id, kind, parent_id, title, description, assignee_id, due_date, priority, column_id, created_by,
                       encrypted, title_enc, description_enc, content_revision, content_author_id, content_signer_device_id)
VALUES ($1, $2, $3, $4, '', '', $5, $6, $7, $8, $9, true, $10, $11, 1, $9, $12)
RETURNING *;

-- name: SetWorkItemContent :execrows
UPDATE work_item
SET encrypted = true, title = '', description = '', title_enc = $2, description_enc = $3,
    content_revision = $4, content_author_id = $5, content_signer_device_id = $6
WHERE id = $1 AND content_revision = $4 - 1;

-- name: CreateEncryptedEpic :one
INSERT INTO epic (id, project_id, title, description, created_by, encrypted, title_enc, description_enc,
                  content_revision, content_author_id, content_signer_device_id)
VALUES ($1, $2, '', '', $3, true, $4, $5, 1, $3, $6)
RETURNING *;

-- name: SetEpicContent :execrows
UPDATE epic
SET encrypted = true, title = '', description = '', title_enc = $2, description_enc = $3,
    content_revision = $4, content_author_id = $5, content_signer_device_id = $6
WHERE id = $1 AND content_revision = $4 - 1;

-- name: CreateEncryptedComment :one
INSERT INTO work_item_comment (id, work_item_id, author_id, body, encrypted, body_enc, content_signer_device_id)
VALUES ($1, $2, $3, '', true, $4, $5)
RETURNING *;

-- name: CreateEncryptedMessage :one
INSERT INTO message (conversation_id, seq, author_id, body, client_mutation_id, reply_to_id, encrypted, body_enc,
                     content_revision, content_signer_device_id)
VALUES ($1, $2, $3, '', $4, $5, $6, $7, 1, $8)
RETURNING *;

-- name: EditEncryptedMessage :one
UPDATE message
SET body = '', encrypted = true, body_enc = $2, content_revision = $3, content_signer_device_id = $4,
    edited_at = CASE WHEN message.encrypted THEN now() ELSE message.edited_at END
WHERE id = $1 AND deleted_at IS NULL AND content_revision = $3 - 1
RETURNING *;

-- name: GetEpic :one
SELECT * FROM epic WHERE id = $1;

-- name: GetWorkItemComment :one
SELECT * FROM work_item_comment WHERE id = $1 FOR UPDATE;

-- name: SetCommentContent :execrows
UPDATE work_item_comment
SET encrypted = true, body = '', body_enc = $2, content_signer_device_id = $3
WHERE id = $1 AND NOT encrypted;

-- name: GetKeyDomainByConversation :one
SELECT * FROM key_domain WHERE conversation_id = $1 AND kind = 'dm';

-- name: CreateDMKeyDomain :one
INSERT INTO key_domain (organization_id, conversation_id, kind) VALUES ($1, $2, 'dm') RETURNING *;

-- name: GetSprintKeyDomain :one
SELECT * FROM key_domain WHERE organization_id = $1 AND kind = 'sprint';

-- name: CreateSprintKeyDomain :one
INSERT INTO key_domain (organization_id, kind) VALUES ($1, 'sprint') RETURNING *;

-- name: ListInternalAccounts :many
SELECT om.account_id
FROM organization_membership AS om JOIN account AS a ON a.id = om.account_id AND a.active
WHERE om.organization_id = $1 AND om.membership_kind = 'internal'
ORDER BY om.account_id;

-- name: SetProjectContent :execrows
UPDATE project
SET encrypted = true, name = '', description = '', name_enc = $2, description_enc = $3,
    content_revision = $4, content_author_id = $5, content_signer_device_id = $6, version = version + 1
WHERE id = $1 AND content_revision = $4 - 1;

-- name: GetProjectForUpdate :one
SELECT * FROM project WHERE id = $1 FOR UPDATE;

-- name: GetConversationForUpdate :one
SELECT * FROM conversation WHERE id = $1 FOR UPDATE;

-- name: SetConversationContent :execrows
UPDATE conversation
SET encrypted = true, name = '', name_enc = $2, content_revision = $3, content_author_id = $4, content_signer_device_id = $5
WHERE id = $1 AND kind = 'channel' AND content_revision = $3 - 1;

-- name: CreateEncryptedSprint :one
INSERT INTO sprint (id, organization_id, name, goal, starts_on, ends_on, created_by, encrypted, name_enc, goal_enc,
                    content_revision, content_author_id, content_signer_device_id)
VALUES ($1, $2, '', '', $3, $4, $5, true, $6, $7, 1, $5, $8)
RETURNING *;

-- name: SetSprintContent :execrows
UPDATE sprint
SET encrypted = true, name = '', goal = '', name_enc = $2, goal_enc = $3,
    content_revision = $4, content_author_id = $5, content_signer_device_id = $6, version = version + 1
WHERE id = $1 AND content_revision = $4 - 1;

-- name: InsertRecoveryAudit :exec
INSERT INTO recovery_audit (organization_id, approver_account_id, approver_device_id, domain_id, generation, recipient_device_id, recipient_account_id)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: ListRecoveryAudit :many
SELECT r.id, r.created_at, r.generation, r.domain_id, COALESCE(kd.kind, '')::text AS domain_kind,
       COALESCE(ap.email_normalized, '')::text AS approver_email, COALESCE(rc.email_normalized, '')::text AS recipient_email
FROM recovery_audit AS r
LEFT JOIN key_domain AS kd ON kd.id = r.domain_id
LEFT JOIN account AS ap ON ap.id = r.approver_account_id
LEFT JOIN account AS rc ON rc.id = r.recipient_account_id
WHERE r.organization_id = $1
ORDER BY r.created_at DESC, r.id
LIMIT 200;

-- name: ListSeatDevices :many
SELECT DISTINCT device_id FROM call_admission
WHERE call_id = $1 AND state IN ('reserved', 'joined') AND device_id IS NOT NULL
ORDER BY device_id;

-- name: InsertCallKeyGeneration :exec
INSERT INTO call_key_generation (call_id, generation, created_by_device) VALUES ($1, $2, $3);

-- name: InsertCallKeyEnvelope :exec
INSERT INTO call_key_envelope (call_id, generation, recipient_device_id, signer_device_id, sealed, signature)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: AdvanceCallKey :exec
UPDATE call SET key_generation = $2 WHERE id = $1;

-- name: ListCallKeyHolders :many
SELECT recipient_device_id FROM call_key_envelope WHERE call_id = $1 AND generation = $2;

-- name: ListCallKeyEnvelopes :many
SELECT * FROM call_key_envelope WHERE call_id = $1 AND recipient_device_id = $2 ORDER BY generation;

-- name: SetProjectInvitePolicy :exec
UPDATE project SET invite_policy = $2, version = version + 1 WHERE id = $1;

-- name: SetProjectMemberManager :execrows
UPDATE project_member SET is_manager = $3 WHERE project_id = $1 AND account_id = $2;
