-- +goose Up
ALTER TABLE external_project_policy DROP CONSTRAINT external_policy_known_permissions;
ALTER TABLE external_project_policy ADD CONSTRAINT external_policy_known_permissions CHECK (permissions <@ ARRAY[
    'work.read', 'work.create', 'work.edit', 'work.move', 'work.archive',
    'work.comment', 'planning.edit', 'chat.read', 'chat.send', 'direct_messages.use',
    'files.upload', 'files.download', 'calls.start', 'calls.join', 'calls.screen_share'
]);
ALTER TABLE external_project_policy
    ALTER COLUMN permissions SET DEFAULT ARRAY[
        'work.read', 'work.comment', 'chat.read', 'chat.send', 'direct_messages.use',
        'files.upload', 'files.download', 'calls.join'
    ];
UPDATE external_project_policy SET permissions = permissions || ARRAY['calls.join'] WHERE version = 1;

ALTER TABLE notification DROP CONSTRAINT notification_kind;
ALTER TABLE notification ADD CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message', 'call_invite'));

CREATE TABLE call (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    started_by uuid REFERENCES account(id) ON DELETE SET NULL,
    state text NOT NULL DEFAULT 'active',
    room_name text NOT NULL UNIQUE,
    screen_sharer_id uuid REFERENCES account(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    ended_reason text,
    CONSTRAINT call_state CHECK (state IN ('active', 'ended')),
    CONSTRAINT call_ended_has_time CHECK (state = 'active' OR ended_at IS NOT NULL)
);

CREATE UNIQUE INDEX call_one_active_per_conversation_idx ON call (conversation_id) WHERE state = 'active';

CREATE TABLE call_invitation (
    call_id uuid NOT NULL REFERENCES call(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    state text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    PRIMARY KEY (call_id, account_id),
    CONSTRAINT call_invitation_state CHECK (state IN ('pending', 'accepted', 'declined', 'cancelled'))
);

CREATE INDEX call_invitation_pending_idx ON call_invitation (account_id) WHERE state = 'pending';

CREATE TABLE call_admission (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id uuid NOT NULL REFERENCES call(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    session_id uuid NOT NULL REFERENCES auth_session(id) ON DELETE CASCADE,
    state text NOT NULL DEFAULT 'reserved',
    reserved_until timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    joined_at timestamptz,
    left_at timestamptz,
    CONSTRAINT call_admission_state CHECK (state IN ('reserved', 'joined', 'left', 'expired'))
);

-- A person occupies at most one seat in the whole product.
CREATE UNIQUE INDEX call_admission_one_active_per_account_idx ON call_admission (account_id) WHERE state IN ('reserved', 'joined');
CREATE INDEX call_admission_call_idx ON call_admission (call_id) WHERE state IN ('reserved', 'joined');

CREATE TABLE livekit_webhook_event (
    event_id text PRIMARY KEY,
    received_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE livekit_webhook_event;
DROP TABLE call_admission;
DROP TABLE call_invitation;
DROP TABLE call;
ALTER TABLE notification DROP CONSTRAINT notification_kind;
ALTER TABLE notification ADD CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message'));
ALTER TABLE external_project_policy DROP CONSTRAINT external_policy_known_permissions;
ALTER TABLE external_project_policy ADD CONSTRAINT external_policy_known_permissions CHECK (permissions <@ ARRAY[
    'work.read', 'work.create', 'work.edit', 'work.move', 'work.archive',
    'work.comment', 'planning.edit', 'chat.read', 'chat.send', 'direct_messages.use',
    'files.upload', 'files.download'
]);
