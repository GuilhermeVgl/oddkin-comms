-- +goose Up
ALTER TABLE notification DROP CONSTRAINT notification_kind;
ALTER TABLE notification ADD CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message', 'call_invite', 'recovery_access', 'followed_update', 'invitation_accepted', 'device_request'));

-- +goose Down
ALTER TABLE notification DROP CONSTRAINT notification_kind;
ALTER TABLE notification ADD CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message', 'call_invite', 'recovery_access', 'followed_update', 'invitation_accepted'));
