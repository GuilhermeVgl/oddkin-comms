-- +goose Up
CREATE TABLE organization (
    id uuid PRIMARY KEY,
    singleton boolean NOT NULL DEFAULT true,
    timezone text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT organization_singleton_true CHECK (singleton),
    CONSTRAINT organization_singleton_unique UNIQUE (singleton),
    CONSTRAINT organization_timezone_not_empty CHECK (btrim(timezone) <> '')
);

-- +goose Down
DROP TABLE organization;
