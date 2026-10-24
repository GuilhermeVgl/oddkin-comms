-- +goose Up
ALTER TABLE attachment
    ADD COLUMN encrypted boolean NOT NULL DEFAULT false,
    ADD COLUMN name_enc bytea,
    ADD COLUMN content_author_id uuid REFERENCES account(id) ON DELETE SET NULL,
    ADD COLUMN content_signer_device_id uuid REFERENCES device(id) ON DELETE SET NULL,
    ADD CONSTRAINT attachment_encryption_metadata CHECK (
        NOT encrypted OR (
            name = '' AND name_enc IS NOT NULL AND content_author_id IS NOT NULL
            AND content_signer_device_id IS NOT NULL
        )
    );

-- +goose Down
ALTER TABLE attachment DROP CONSTRAINT attachment_encryption_metadata;
ALTER TABLE attachment DROP COLUMN content_signer_device_id;
ALTER TABLE attachment DROP COLUMN content_author_id;
ALTER TABLE attachment DROP COLUMN name_enc;
ALTER TABLE attachment DROP COLUMN encrypted;
