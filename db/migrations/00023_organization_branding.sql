-- +goose Up
ALTER TABLE organization
    ADD COLUMN name text,
    ADD COLUMN logo_data bytea,
    ADD COLUMN logo_mime text,
    ADD COLUMN show_duo boolean NOT NULL DEFAULT true,
    ADD CONSTRAINT organization_name_length CHECK (name IS NULL OR (char_length(btrim(name)) BETWEEN 1 AND 80)),
    ADD CONSTRAINT organization_logo_pair CHECK ((logo_data IS NULL) = (logo_mime IS NULL)),
    ADD CONSTRAINT organization_logo_size CHECK (logo_data IS NULL OR octet_length(logo_data) <= 1048576),
    ADD CONSTRAINT organization_logo_mime CHECK (logo_mime IS NULL OR logo_mime IN ('image/png', 'image/jpeg', 'image/webp'));

-- +goose Down
ALTER TABLE organization
    DROP CONSTRAINT organization_logo_mime,
    DROP CONSTRAINT organization_logo_size,
    DROP CONSTRAINT organization_logo_pair,
    DROP CONSTRAINT organization_name_length,
    DROP COLUMN show_duo,
    DROP COLUMN logo_mime,
    DROP COLUMN logo_data,
    DROP COLUMN name;
