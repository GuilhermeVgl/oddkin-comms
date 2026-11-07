-- +goose Up
ALTER TABLE account
ADD COLUMN display_name text NOT NULL DEFAULT '',
ADD CONSTRAINT account_display_name_format CHECK (
    display_name = btrim(display_name) AND char_length(display_name) <= 80
);

-- +goose Down
ALTER TABLE account DROP CONSTRAINT account_display_name_format;
ALTER TABLE account DROP COLUMN display_name;
