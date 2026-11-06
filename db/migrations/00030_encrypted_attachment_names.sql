-- +goose Up
-- Encrypted names live only in name_enc; their plaintext column is deliberately empty.
ALTER TABLE attachment DROP CONSTRAINT attachment_name_length;
ALTER TABLE attachment ADD CONSTRAINT attachment_name_length CHECK (
    (encrypted AND name = '')
    OR (NOT encrypted AND char_length(btrim(name)) BETWEEN 1 AND 255)
);

-- +goose Down
ALTER TABLE attachment DROP CONSTRAINT attachment_name_length;
ALTER TABLE attachment ADD CONSTRAINT attachment_name_length CHECK (
    char_length(btrim(name)) BETWEEN 1 AND 255
);
