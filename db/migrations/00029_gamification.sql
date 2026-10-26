-- +goose Up
-- When an activity reached a "done" column. Streaks and the personal
-- scoreboard count these moments; the title and description stay encrypted.
ALTER TABLE work_item ADD COLUMN completed_at timestamptz;

UPDATE work_item SET completed_at = updated_at
WHERE column_id IN (SELECT id FROM board_column WHERE category = 'done');

-- +goose StatementBegin
CREATE FUNCTION work_item_track_completion() RETURNS trigger AS $$
DECLARE
    now_done boolean;
    was_done boolean := false;
BEGIN
    SELECT category = 'done' INTO now_done FROM board_column WHERE id = NEW.column_id;
    IF NOT COALESCE(now_done, false) THEN
        NEW.completed_at := NULL;
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        SELECT category = 'done' INTO was_done FROM board_column WHERE id = OLD.column_id;
    END IF;
    -- Moving between two done columns keeps the original moment.
    IF NOT COALESCE(was_done, false) THEN
        NEW.completed_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER work_item_completion
    BEFORE INSERT OR UPDATE OF column_id ON work_item
    FOR EACH ROW EXECUTE FUNCTION work_item_track_completion();

CREATE INDEX work_item_completed_idx ON work_item (assignee_id, completed_at) WHERE completed_at IS NOT NULL;

-- A "thanks" for finished work. One per person per activity.
CREATE TABLE work_item_kudos (
    work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
    from_account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (work_item_id, from_account_id)
);

-- Time spent in focus mode on an activity, in whole minutes.
CREATE TABLE focus_session (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
    minutes integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT focus_session_minutes CHECK (minutes BETWEEN 1 AND 180)
);

CREATE INDEX focus_session_account_idx ON focus_session (account_id);
CREATE INDEX focus_session_item_idx ON focus_session (work_item_id);

ALTER TABLE notification DROP CONSTRAINT notification_kind;
ALTER TABLE notification ADD CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message', 'call_invite', 'recovery_access', 'followed_update', 'invitation_accepted', 'device_request', 'kudos'));

-- +goose Down
DELETE FROM notification WHERE kind = 'kudos';
ALTER TABLE notification DROP CONSTRAINT notification_kind;
ALTER TABLE notification ADD CONSTRAINT notification_kind CHECK (kind IN ('mention', 'assignment', 'direct_message', 'call_invite', 'recovery_access', 'followed_update', 'invitation_accepted', 'device_request'));
DROP TABLE focus_session;
DROP TABLE work_item_kudos;
DROP TRIGGER work_item_completion ON work_item;
DROP FUNCTION work_item_track_completion();
DROP INDEX work_item_completed_idx;
ALTER TABLE work_item DROP COLUMN completed_at;
