-- +goose Up
CREATE TABLE project (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    color text NOT NULL DEFAULT '#63745A',
    icon text NOT NULL DEFAULT 'folder',
    archived boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1,
    created_by uuid REFERENCES account(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT project_description_length CHECK (char_length(description) <= 2000),
    CONSTRAINT project_color_format CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE project_member (
    project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    is_manager boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, account_id)
);

CREATE INDEX project_member_account_idx ON project_member (account_id, project_id);

CREATE TABLE external_project_policy (
    project_id uuid PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
    permissions text[] NOT NULL DEFAULT ARRAY['work.read', 'work.comment'],
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT external_policy_known_permissions CHECK (permissions <@ ARRAY[
        'work.read', 'work.create', 'work.edit', 'work.move', 'work.archive',
        'work.comment', 'planning.edit'
    ])
);

CREATE TABLE board_column (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name text NOT NULL,
    position integer NOT NULL,
    category text NOT NULL,
    UNIQUE (id, project_id),
    CONSTRAINT board_column_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    CONSTRAINT board_column_category CHECK (category IN ('todo', 'in_progress', 'done'))
);

CREATE INDEX board_column_project_idx ON board_column (project_id, position);

CREATE TABLE work_item (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    kind text NOT NULL,
    parent_id uuid,
    parent_kind text GENERATED ALWAYS AS (CASE WHEN kind = 'subtask' THEN 'task' END) STORED,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    assignee_id uuid,
    due_date date,
    priority text NOT NULL DEFAULT 'normal',
    column_id uuid NOT NULL,
    archived boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1,
    created_by uuid REFERENCES account(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, project_id),
    UNIQUE (id, project_id, kind),
    FOREIGN KEY (column_id, project_id) REFERENCES board_column (id, project_id),
    FOREIGN KEY (parent_id, project_id, parent_kind) REFERENCES work_item (id, project_id, kind),
    FOREIGN KEY (project_id, assignee_id) REFERENCES project_member (project_id, account_id)
        ON DELETE SET NULL (assignee_id),
    CONSTRAINT work_item_kind CHECK (kind IN ('task', 'subtask')),
    CONSTRAINT work_item_parent_matches_kind CHECK (
        (kind = 'task' AND parent_id IS NULL) OR (kind = 'subtask' AND parent_id IS NOT NULL)
    ),
    CONSTRAINT work_item_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT work_item_description_length CHECK (char_length(description) <= 50000),
    CONSTRAINT work_item_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
);

CREATE INDEX work_item_project_column_idx ON work_item (project_id, column_id) WHERE NOT archived;
CREATE INDEX work_item_parent_idx ON work_item (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE work_item_comment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
    author_id uuid REFERENCES account(id) ON DELETE SET NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT work_item_comment_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000)
);

CREATE INDEX work_item_comment_item_idx ON work_item_comment (work_item_id, created_at);

-- +goose Down
DROP TABLE work_item_comment;
DROP TABLE work_item;
DROP TABLE board_column;
DROP TABLE external_project_policy;
DROP TABLE project_member;
DROP TABLE project;
