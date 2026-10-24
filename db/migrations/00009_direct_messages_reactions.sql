-- +goose Up
ALTER TABLE external_project_policy DROP CONSTRAINT external_policy_known_permissions;
ALTER TABLE external_project_policy ADD CONSTRAINT external_policy_known_permissions CHECK (permissions <@ ARRAY[
    'work.read', 'work.create', 'work.edit', 'work.move', 'work.archive',
    'work.comment', 'planning.edit', 'chat.read', 'chat.send', 'direct_messages.use'
]);
ALTER TABLE external_project_policy
    ALTER COLUMN permissions SET DEFAULT ARRAY['work.read', 'work.comment', 'chat.read', 'chat.send', 'direct_messages.use'];
UPDATE external_project_policy SET permissions = permissions || ARRAY['direct_messages.use'] WHERE version = 1;

ALTER TABLE conversation ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE conversation ADD COLUMN kind text NOT NULL DEFAULT 'channel';
ALTER TABLE conversation ADD COLUMN dm_low uuid REFERENCES account(id) ON DELETE CASCADE;
ALTER TABLE conversation ADD COLUMN dm_high uuid REFERENCES account(id) ON DELETE CASCADE;
ALTER TABLE conversation ADD CONSTRAINT conversation_kind_shape CHECK (
    (kind = 'channel' AND project_id IS NOT NULL AND dm_low IS NULL AND dm_high IS NULL)
    OR (kind = 'dm' AND project_id IS NULL AND dm_low IS NOT NULL AND dm_high IS NOT NULL AND dm_low < dm_high)
);
CREATE UNIQUE INDEX conversation_dm_pair_idx ON conversation (dm_low, dm_high) WHERE kind = 'dm';

ALTER TABLE message ADD COLUMN reply_to_id uuid;
ALTER TABLE message ADD COLUMN edited_at timestamptz;
ALTER TABLE message ADD COLUMN deleted_at timestamptz;
ALTER TABLE message ADD CONSTRAINT message_id_conversation_unique UNIQUE (id, conversation_id);
ALTER TABLE message ADD CONSTRAINT message_reply_same_conversation
    FOREIGN KEY (reply_to_id, conversation_id) REFERENCES message (id, conversation_id);
ALTER TABLE message DROP CONSTRAINT message_body_length;
ALTER TABLE message ADD CONSTRAINT message_body_length CHECK (
    (deleted_at IS NOT NULL AND body = '') OR (deleted_at IS NULL AND char_length(btrim(body)) BETWEEN 1 AND 10000)
);

CREATE TABLE message_reaction (
    message_id uuid NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    emoji text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, account_id, emoji),
    CONSTRAINT message_reaction_emoji_length CHECK (octet_length(emoji) BETWEEN 1 AND 32)
);

-- +goose Down
DROP TABLE message_reaction;
ALTER TABLE message DROP CONSTRAINT message_body_length;
ALTER TABLE message ADD CONSTRAINT message_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000);
ALTER TABLE message DROP COLUMN reply_to_id, DROP COLUMN edited_at, DROP COLUMN deleted_at;
ALTER TABLE message DROP CONSTRAINT message_id_conversation_unique;
DELETE FROM conversation WHERE kind = 'dm';
ALTER TABLE conversation DROP COLUMN kind, DROP COLUMN dm_low, DROP COLUMN dm_high;
ALTER TABLE conversation ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE external_project_policy DROP CONSTRAINT external_policy_known_permissions;
ALTER TABLE external_project_policy ADD CONSTRAINT external_policy_known_permissions CHECK (permissions <@ ARRAY[
    'work.read', 'work.create', 'work.edit', 'work.move', 'work.archive',
    'work.comment', 'planning.edit', 'chat.read', 'chat.send'
]);
