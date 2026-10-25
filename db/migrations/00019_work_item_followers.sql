-- +goose Up
-- People following an activity are told, inside the app, when it moves or gets a comment.
CREATE TABLE work_item_follower (
    work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (work_item_id, account_id)
);

CREATE INDEX work_item_follower_account_idx ON work_item_follower (account_id);

ALTER TABLE notification DROP CONSTRAINT notification_kind;
ALTER TABLE notification ADD CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message', 'call_invite', 'recovery_access', 'followed_update'));

-- +goose Down
ALTER TABLE notification DROP CONSTRAINT notification_kind;
ALTER TABLE notification ADD CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message', 'call_invite', 'recovery_access'));
DROP TABLE work_item_follower;
