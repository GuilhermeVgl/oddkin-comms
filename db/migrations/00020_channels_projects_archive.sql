-- +goose Up
-- Channels can be archived (read-only) and ordered by project managers.
ALTER TABLE conversation
    ADD COLUMN archived boolean NOT NULL DEFAULT false,
    ADD COLUMN position integer NOT NULL DEFAULT 0;

UPDATE conversation AS c SET position = ranked.position
FROM (
    SELECT id, (row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) - 1)::integer AS position
    FROM conversation WHERE kind = 'channel'
) AS ranked
WHERE c.id = ranked.id;

-- +goose Down
ALTER TABLE conversation DROP COLUMN archived, DROP COLUMN position;
