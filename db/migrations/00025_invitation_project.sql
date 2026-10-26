-- +goose Up
-- An invitation made from a project also adds the person to it when accepted.
ALTER TABLE organization_invitation
    ADD COLUMN project_id uuid REFERENCES project(id) ON DELETE SET NULL;

ALTER TABLE notification DROP CONSTRAINT notification_kind;
ALTER TABLE notification ADD CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message', 'call_invite', 'recovery_access', 'followed_update', 'invitation_accepted'));

-- +goose Down
ALTER TABLE notification DROP CONSTRAINT notification_kind;
ALTER TABLE notification ADD CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message', 'call_invite', 'recovery_access', 'followed_update'));
ALTER TABLE organization_invitation DROP COLUMN project_id;
