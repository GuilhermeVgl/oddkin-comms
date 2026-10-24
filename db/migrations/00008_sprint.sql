-- +goose Up
CREATE TABLE sprint (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    name text NOT NULL,
    goal text NOT NULL DEFAULT '',
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    state text NOT NULL DEFAULT 'planned',
    closed_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_by uuid REFERENCES account(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sprint_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT sprint_goal_length CHECK (char_length(goal) <= 2000),
    CONSTRAINT sprint_dates_ordered CHECK (starts_on <= ends_on),
    CONSTRAINT sprint_state CHECK (state IN ('planned', 'active', 'closed'))
);

CREATE UNIQUE INDEX sprint_one_active_idx ON sprint (organization_id) WHERE state = 'active';

ALTER TABLE work_item ADD COLUMN sprint_id uuid REFERENCES sprint(id) ON DELETE SET NULL;
ALTER TABLE work_item ADD CONSTRAINT work_item_sprint_only_on_tasks CHECK (sprint_id IS NULL OR kind = 'task');
CREATE INDEX work_item_sprint_idx ON work_item (sprint_id) WHERE sprint_id IS NOT NULL;

CREATE TABLE sprint_item_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sprint_id uuid NOT NULL REFERENCES sprint(id) ON DELETE CASCADE,
    work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
    outcome text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sprint_id, work_item_id),
    CONSTRAINT sprint_item_history_outcome CHECK (outcome IN ('completed', 'carried', 'backlog'))
);

-- +goose Down
DROP TABLE sprint_item_history;
ALTER TABLE work_item DROP COLUMN sprint_id;
DROP TABLE sprint;
