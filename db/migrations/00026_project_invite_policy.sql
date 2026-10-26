-- +goose Up
-- Who may bring people into a project, changeable by its managers:
--   admins   : only organization administrators (the default, as before)
--   managers : also the project's managers
--   members  : also any internal member of the project
ALTER TABLE project
    ADD COLUMN invite_policy text NOT NULL DEFAULT 'admins',
    ADD CONSTRAINT project_invite_policy CHECK (invite_policy IN ('admins', 'managers', 'members'));

-- +goose Down
ALTER TABLE project DROP CONSTRAINT project_invite_policy, DROP COLUMN invite_policy;
