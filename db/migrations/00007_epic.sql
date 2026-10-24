-- +goose Up
CREATE TABLE epic (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    done boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1,
    created_by uuid REFERENCES account(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, project_id),
    CONSTRAINT epic_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT epic_description_length CHECK (char_length(description) <= 50000)
);

CREATE INDEX epic_project_idx ON epic (project_id, created_at);

ALTER TABLE work_item ADD COLUMN epic_id uuid;
ALTER TABLE work_item ADD CONSTRAINT work_item_epic_fk
    FOREIGN KEY (epic_id, project_id) REFERENCES epic (id, project_id) ON DELETE SET NULL (epic_id);
ALTER TABLE work_item ADD CONSTRAINT work_item_epic_only_on_tasks CHECK (epic_id IS NULL OR kind = 'task');
CREATE INDEX work_item_epic_idx ON work_item (epic_id) WHERE epic_id IS NOT NULL;

-- +goose Down
ALTER TABLE work_item DROP COLUMN epic_id;
DROP TABLE epic;
