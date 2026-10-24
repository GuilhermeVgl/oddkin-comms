-- +goose Up
CREATE TABLE user_event_cursor (
    account_id uuid PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
    last_seq bigint NOT NULL DEFAULT 0
);

CREATE TABLE user_event (
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    seq bigint NOT NULL,
    event_id uuid NOT NULL,
    type text NOT NULL,
    resource_id uuid NOT NULL,
    resource_version integer NOT NULL DEFAULT 0,
    project_id uuid REFERENCES project(id) ON DELETE CASCADE,
    conversation_id uuid REFERENCES conversation(id) ON DELETE CASCADE,
    required_permission text,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, seq),
    UNIQUE (event_id, account_id)
);

CREATE INDEX user_event_retention_idx ON user_event (occurred_at);

CREATE TABLE notification (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    kind text NOT NULL,
    resource_id uuid NOT NULL,
    project_id uuid REFERENCES project(id) ON DELETE CASCADE,
    conversation_id uuid REFERENCES conversation(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz,
    CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message'))
);

CREATE INDEX notification_account_idx ON notification (account_id, created_at DESC);

CREATE TABLE conversation_read_cursor (
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    last_seq bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, conversation_id)
);

-- +goose Down
DROP TABLE conversation_read_cursor;
DROP TABLE notification;
DROP TABLE user_event;
DROP TABLE user_event_cursor;
