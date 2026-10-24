-- +goose Up
ALTER TABLE external_project_policy DROP CONSTRAINT external_policy_known_permissions;
ALTER TABLE external_project_policy ADD CONSTRAINT external_policy_known_permissions CHECK (permissions <@ ARRAY[
    'work.read', 'work.create', 'work.edit', 'work.move', 'work.archive',
    'work.comment', 'planning.edit', 'chat.read', 'chat.send'
]);
ALTER TABLE external_project_policy
    ALTER COLUMN permissions SET DEFAULT ARRAY['work.read', 'work.comment', 'chat.read', 'chat.send'];
UPDATE external_project_policy SET permissions = permissions || ARRAY['chat.read', 'chat.send'] WHERE version = 1;

CREATE TABLE conversation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name text NOT NULL,
    last_seq bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, name),
    CONSTRAINT conversation_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 60)
);

INSERT INTO conversation (project_id, name) SELECT id, 'geral' FROM project;

CREATE TABLE message (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    seq bigint NOT NULL,
    author_id uuid REFERENCES account(id) ON DELETE SET NULL,
    body text NOT NULL,
    client_mutation_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, seq),
    UNIQUE (conversation_id, author_id, client_mutation_id),
    CONSTRAINT message_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000)
);

-- +goose Down
DROP TABLE message;
DROP TABLE conversation;
ALTER TABLE external_project_policy DROP CONSTRAINT external_policy_known_permissions;
ALTER TABLE external_project_policy ADD CONSTRAINT external_policy_known_permissions CHECK (permissions <@ ARRAY[
    'work.read', 'work.create', 'work.edit', 'work.move', 'work.archive',
    'work.comment', 'planning.edit'
]);
ALTER TABLE external_project_policy ALTER COLUMN permissions SET DEFAULT ARRAY['work.read', 'work.comment'];
