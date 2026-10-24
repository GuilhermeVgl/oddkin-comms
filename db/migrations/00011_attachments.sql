-- +goose Up
ALTER TABLE external_project_policy DROP CONSTRAINT external_policy_known_permissions;
ALTER TABLE external_project_policy ADD CONSTRAINT external_policy_known_permissions CHECK (permissions <@ ARRAY[
    'work.read', 'work.create', 'work.edit', 'work.move', 'work.archive',
    'work.comment', 'planning.edit', 'chat.read', 'chat.send', 'direct_messages.use',
    'files.upload', 'files.download'
]);
ALTER TABLE external_project_policy
    ALTER COLUMN permissions SET DEFAULT ARRAY[
        'work.read', 'work.comment', 'chat.read', 'chat.send', 'direct_messages.use',
        'files.upload', 'files.download'
    ];
UPDATE external_project_policy SET permissions = permissions || ARRAY['files.upload', 'files.download'] WHERE version = 1;

CREATE TABLE attachment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    project_id uuid REFERENCES project(id) ON DELETE CASCADE,
    work_item_id uuid REFERENCES work_item(id) ON DELETE CASCADE,
    conversation_id uuid REFERENCES conversation(id) ON DELETE CASCADE,
    uploader_id uuid REFERENCES account(id) ON DELETE SET NULL,
    state text NOT NULL DEFAULT 'uploading',
    object_key text NOT NULL UNIQUE,
    upload_id text NOT NULL,
    name text NOT NULL,
    content_type text NOT NULL DEFAULT 'application/octet-stream',
    declared_size bigint NOT NULL,
    part_size integer NOT NULL,
    part_count integer NOT NULL,
    stored_size bigint,
    object_removed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    ready_at timestamptz,
    CONSTRAINT attachment_state CHECK (state IN ('uploading', 'ready', 'aborted', 'deleted')),
    CONSTRAINT attachment_single_context CHECK (num_nonnulls(work_item_id, conversation_id) = 1),
    CONSTRAINT attachment_size_limit CHECK (declared_size BETWEEN 1 AND 500000000),
    CONSTRAINT attachment_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 255),
    CONSTRAINT attachment_ready_has_size CHECK (state <> 'ready' OR stored_size IS NOT NULL)
);

CREATE UNIQUE INDEX attachment_one_active_upload_idx ON attachment (uploader_id) WHERE state = 'uploading';
CREATE INDEX attachment_work_item_idx ON attachment (work_item_id) WHERE state = 'ready';
CREATE INDEX attachment_conversation_idx ON attachment (conversation_id) WHERE state = 'ready';
CREATE INDEX attachment_release_idx ON attachment (created_at) WHERE state IN ('aborted', 'deleted') AND NOT object_removed;
CREATE INDEX attachment_expiry_idx ON attachment (created_at) WHERE state = 'uploading';

-- +goose Down
DROP TABLE attachment;
ALTER TABLE external_project_policy DROP CONSTRAINT external_policy_known_permissions;
ALTER TABLE external_project_policy ADD CONSTRAINT external_policy_known_permissions CHECK (permissions <@ ARRAY[
    'work.read', 'work.create', 'work.edit', 'work.move', 'work.archive',
    'work.comment', 'planning.edit', 'chat.read', 'chat.send', 'direct_messages.use'
]);
