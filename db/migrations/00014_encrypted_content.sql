-- +goose Up
-- Encrypted rows keep their plaintext column empty; the envelope lives in *_enc.
-- A row is either legacy plaintext or encrypted, never both.

ALTER TABLE work_item
    ADD COLUMN encrypted boolean NOT NULL DEFAULT false,
    ADD COLUMN title_enc bytea,
    ADD COLUMN description_enc bytea,
    ADD COLUMN content_revision integer NOT NULL DEFAULT 0,
    ADD COLUMN content_author_id uuid REFERENCES account(id) ON DELETE SET NULL,
    ADD COLUMN content_signer_device_id uuid REFERENCES device(id) ON DELETE SET NULL;
ALTER TABLE work_item DROP CONSTRAINT work_item_title_length;
ALTER TABLE work_item ADD CONSTRAINT work_item_title_length CHECK (encrypted OR char_length(btrim(title)) BETWEEN 1 AND 200);
ALTER TABLE work_item ADD CONSTRAINT work_item_encrypted_shape CHECK (
    (NOT encrypted AND title_enc IS NULL AND description_enc IS NULL)
    OR (encrypted AND title = '' AND description = '' AND content_revision >= 1
        AND octet_length(title_enc) BETWEEN 1 AND 4096 AND octet_length(description_enc) BETWEEN 1 AND 262144)
);

ALTER TABLE epic
    ADD COLUMN encrypted boolean NOT NULL DEFAULT false,
    ADD COLUMN title_enc bytea,
    ADD COLUMN description_enc bytea,
    ADD COLUMN content_revision integer NOT NULL DEFAULT 0,
    ADD COLUMN content_author_id uuid REFERENCES account(id) ON DELETE SET NULL,
    ADD COLUMN content_signer_device_id uuid REFERENCES device(id) ON DELETE SET NULL;
ALTER TABLE epic DROP CONSTRAINT epic_title_length;
ALTER TABLE epic ADD CONSTRAINT epic_title_length CHECK (encrypted OR char_length(btrim(title)) BETWEEN 1 AND 200);
ALTER TABLE epic ADD CONSTRAINT epic_encrypted_shape CHECK (
    (NOT encrypted AND title_enc IS NULL AND description_enc IS NULL)
    OR (encrypted AND title = '' AND description = '' AND content_revision >= 1
        AND octet_length(title_enc) BETWEEN 1 AND 4096 AND octet_length(description_enc) BETWEEN 1 AND 262144)
);

ALTER TABLE work_item_comment
    ADD COLUMN encrypted boolean NOT NULL DEFAULT false,
    ADD COLUMN body_enc bytea,
    ADD COLUMN content_signer_device_id uuid REFERENCES device(id) ON DELETE SET NULL;
ALTER TABLE work_item_comment DROP CONSTRAINT work_item_comment_body_length;
ALTER TABLE work_item_comment ADD CONSTRAINT work_item_comment_body_length CHECK (
    (NOT encrypted AND body_enc IS NULL AND char_length(btrim(body)) BETWEEN 1 AND 10000)
    OR (encrypted AND body = '' AND octet_length(body_enc) BETWEEN 1 AND 262144)
);

ALTER TABLE message
    ADD COLUMN encrypted boolean NOT NULL DEFAULT false,
    ADD COLUMN body_enc bytea,
    ADD COLUMN content_revision integer NOT NULL DEFAULT 0,
    ADD COLUMN content_signer_device_id uuid REFERENCES device(id) ON DELETE SET NULL;
ALTER TABLE message DROP CONSTRAINT message_body_length;
ALTER TABLE message ADD CONSTRAINT message_body_length CHECK (
    (deleted_at IS NOT NULL AND body = '' AND body_enc IS NULL)
    OR (deleted_at IS NULL AND NOT encrypted AND body_enc IS NULL AND char_length(btrim(body)) BETWEEN 1 AND 10000)
    OR (deleted_at IS NULL AND encrypted AND body = '' AND content_revision >= 1 AND octet_length(body_enc) BETWEEN 1 AND 262144)
);

-- +goose Down
ALTER TABLE message DROP CONSTRAINT message_body_length;
ALTER TABLE message ADD CONSTRAINT message_body_length CHECK (
    (deleted_at IS NOT NULL AND body = '') OR (deleted_at IS NULL AND char_length(btrim(body)) BETWEEN 1 AND 10000)
);
ALTER TABLE message DROP COLUMN encrypted, DROP COLUMN body_enc, DROP COLUMN content_revision, DROP COLUMN content_signer_device_id;
ALTER TABLE work_item_comment DROP CONSTRAINT work_item_comment_body_length;
ALTER TABLE work_item_comment ADD CONSTRAINT work_item_comment_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000);
ALTER TABLE work_item_comment DROP COLUMN encrypted, DROP COLUMN body_enc, DROP COLUMN content_signer_device_id;
ALTER TABLE epic DROP CONSTRAINT epic_encrypted_shape;
ALTER TABLE epic DROP CONSTRAINT epic_title_length;
ALTER TABLE epic ADD CONSTRAINT epic_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 200);
ALTER TABLE epic DROP COLUMN encrypted, DROP COLUMN title_enc, DROP COLUMN description_enc, DROP COLUMN content_revision,
    DROP COLUMN content_author_id, DROP COLUMN content_signer_device_id;
ALTER TABLE work_item DROP CONSTRAINT work_item_encrypted_shape;
ALTER TABLE work_item DROP CONSTRAINT work_item_title_length;
ALTER TABLE work_item ADD CONSTRAINT work_item_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 200);
ALTER TABLE work_item DROP COLUMN encrypted, DROP COLUMN title_enc, DROP COLUMN description_enc, DROP COLUMN content_revision,
    DROP COLUMN content_author_id, DROP COLUMN content_signer_device_id;
