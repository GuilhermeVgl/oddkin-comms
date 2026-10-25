-- +goose Up
-- Deleted attachments keep their object for 30 days so a database restore finds it again.
ALTER TABLE attachment ADD COLUMN released_at timestamptz;
UPDATE attachment SET released_at = now() WHERE state IN ('aborted', 'deleted');

-- +goose Down
ALTER TABLE attachment DROP COLUMN released_at;
