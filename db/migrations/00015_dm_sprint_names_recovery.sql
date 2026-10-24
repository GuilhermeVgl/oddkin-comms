-- +goose Up
-- Key domains for DMs and sprints, encrypted names, and the recovery audit trail.

ALTER TABLE key_domain ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE key_domain ADD COLUMN conversation_id uuid REFERENCES conversation(id) ON DELETE CASCADE;
ALTER TABLE key_domain DROP CONSTRAINT key_domain_kind;
ALTER TABLE key_domain ADD CONSTRAINT key_domain_kind CHECK (kind IN ('work', 'chat', 'dm', 'sprint'));
ALTER TABLE key_domain ADD CONSTRAINT key_domain_scope CHECK (
    (kind IN ('work', 'chat') AND project_id IS NOT NULL AND conversation_id IS NULL)
    OR (kind = 'dm' AND conversation_id IS NOT NULL AND project_id IS NULL)
    OR (kind = 'sprint' AND project_id IS NULL AND conversation_id IS NULL)
);
CREATE UNIQUE INDEX key_domain_dm_idx ON key_domain (conversation_id) WHERE kind = 'dm';
CREATE UNIQUE INDEX key_domain_sprint_idx ON key_domain (organization_id) WHERE kind = 'sprint';

-- Project names and descriptions.
ALTER TABLE project
    ADD COLUMN encrypted boolean NOT NULL DEFAULT false,
    ADD COLUMN name_enc bytea,
    ADD COLUMN description_enc bytea,
    ADD COLUMN content_revision integer NOT NULL DEFAULT 0,
    ADD COLUMN content_author_id uuid REFERENCES account(id) ON DELETE SET NULL,
    ADD COLUMN content_signer_device_id uuid REFERENCES device(id) ON DELETE SET NULL;
ALTER TABLE project DROP CONSTRAINT project_name_length;
ALTER TABLE project ADD CONSTRAINT project_name_length CHECK (encrypted OR char_length(btrim(name)) BETWEEN 1 AND 120);
ALTER TABLE project ADD CONSTRAINT project_encrypted_shape CHECK (
    (NOT encrypted AND name_enc IS NULL AND description_enc IS NULL)
    OR (encrypted AND name = '' AND description = '' AND content_revision >= 1
        AND octet_length(name_enc) BETWEEN 1 AND 4096 AND octet_length(description_enc) BETWEEN 1 AND 65536)
);

-- Channel names. Encrypted names are empty, so uniqueness only applies to legacy ones.
ALTER TABLE conversation
    ADD COLUMN encrypted boolean NOT NULL DEFAULT false,
    ADD COLUMN name_enc bytea,
    ADD COLUMN content_revision integer NOT NULL DEFAULT 0,
    ADD COLUMN content_author_id uuid REFERENCES account(id) ON DELETE SET NULL,
    ADD COLUMN content_signer_device_id uuid REFERENCES device(id) ON DELETE SET NULL;
ALTER TABLE conversation DROP CONSTRAINT conversation_name_length;
ALTER TABLE conversation DROP CONSTRAINT conversation_project_id_name_key;
ALTER TABLE conversation ADD CONSTRAINT conversation_name_length CHECK (encrypted OR char_length(btrim(name)) BETWEEN 1 AND 60);
CREATE UNIQUE INDEX conversation_project_name_idx ON conversation (project_id, name) WHERE NOT encrypted;
ALTER TABLE conversation ADD CONSTRAINT conversation_encrypted_shape CHECK (
    (NOT encrypted AND name_enc IS NULL)
    OR (encrypted AND kind = 'channel' AND name = '' AND content_revision >= 1 AND octet_length(name_enc) BETWEEN 1 AND 4096)
);

-- Sprint names and goals. Dates stay readable: the server and the board use them.
ALTER TABLE sprint
    ADD COLUMN encrypted boolean NOT NULL DEFAULT false,
    ADD COLUMN name_enc bytea,
    ADD COLUMN goal_enc bytea,
    ADD COLUMN content_revision integer NOT NULL DEFAULT 0,
    ADD COLUMN content_author_id uuid REFERENCES account(id) ON DELETE SET NULL,
    ADD COLUMN content_signer_device_id uuid REFERENCES device(id) ON DELETE SET NULL;
ALTER TABLE sprint DROP CONSTRAINT sprint_name_length;
ALTER TABLE sprint ADD CONSTRAINT sprint_name_length CHECK (encrypted OR char_length(btrim(name)) BETWEEN 1 AND 120);
ALTER TABLE sprint ADD CONSTRAINT sprint_encrypted_shape CHECK (
    (NOT encrypted AND name_enc IS NULL AND goal_enc IS NULL)
    OR (encrypted AND name = '' AND goal = '' AND content_revision >= 1
        AND octet_length(name_enc) BETWEEN 1 AND 4096 AND octet_length(goal_enc) BETWEEN 1 AND 65536)
);

-- Recovery: every use of the recovery identity leaves a record, and the person is told.
CREATE TABLE recovery_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    approver_account_id uuid REFERENCES account(id) ON DELETE SET NULL,
    approver_device_id uuid REFERENCES device(id) ON DELETE SET NULL,
    domain_id uuid REFERENCES key_domain(id) ON DELETE SET NULL,
    generation integer NOT NULL,
    recipient_device_id uuid REFERENCES device(id) ON DELETE SET NULL,
    recipient_account_id uuid REFERENCES account(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recovery_audit_org_idx ON recovery_audit (organization_id, created_at DESC);

ALTER TABLE notification DROP CONSTRAINT notification_kind;
ALTER TABLE notification ADD CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message', 'call_invite', 'recovery_access'));

-- +goose Down
ALTER TABLE notification DROP CONSTRAINT notification_kind;
ALTER TABLE notification ADD CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message', 'call_invite'));
DROP TABLE recovery_audit;
ALTER TABLE sprint DROP CONSTRAINT sprint_encrypted_shape;
ALTER TABLE sprint DROP CONSTRAINT sprint_name_length;
ALTER TABLE sprint ADD CONSTRAINT sprint_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 120);
ALTER TABLE sprint DROP COLUMN encrypted, DROP COLUMN name_enc, DROP COLUMN goal_enc, DROP COLUMN content_revision,
    DROP COLUMN content_author_id, DROP COLUMN content_signer_device_id;
ALTER TABLE conversation DROP CONSTRAINT conversation_encrypted_shape;
DROP INDEX conversation_project_name_idx;
ALTER TABLE conversation DROP CONSTRAINT conversation_name_length;
ALTER TABLE conversation ADD CONSTRAINT conversation_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 60);
ALTER TABLE conversation ADD CONSTRAINT conversation_project_id_name_key UNIQUE (project_id, name);
ALTER TABLE conversation DROP COLUMN encrypted, DROP COLUMN name_enc, DROP COLUMN content_revision,
    DROP COLUMN content_author_id, DROP COLUMN content_signer_device_id;
ALTER TABLE project DROP CONSTRAINT project_encrypted_shape;
ALTER TABLE project DROP CONSTRAINT project_name_length;
ALTER TABLE project ADD CONSTRAINT project_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 120);
ALTER TABLE project DROP COLUMN encrypted, DROP COLUMN name_enc, DROP COLUMN description_enc, DROP COLUMN content_revision,
    DROP COLUMN content_author_id, DROP COLUMN content_signer_device_id;
DROP INDEX key_domain_sprint_idx;
DROP INDEX key_domain_dm_idx;
ALTER TABLE key_domain DROP CONSTRAINT key_domain_scope;
ALTER TABLE key_domain DROP CONSTRAINT key_domain_kind;
ALTER TABLE key_domain ADD CONSTRAINT key_domain_kind CHECK (kind IN ('work', 'chat'));
ALTER TABLE key_domain DROP COLUMN conversation_id;
ALTER TABLE key_domain ALTER COLUMN project_id SET NOT NULL;
