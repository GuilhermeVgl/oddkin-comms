-- +goose Up
-- A "files" key domain per project (readers: members who may download files)
-- and attachments whose body is end-to-end encrypted (ADR 0019).
ALTER TABLE key_domain DROP CONSTRAINT key_domain_kind;
ALTER TABLE key_domain ADD CONSTRAINT key_domain_kind CHECK (kind IN ('work', 'chat', 'files', 'dm', 'sprint'));

ALTER TABLE key_domain DROP CONSTRAINT key_domain_scope;
ALTER TABLE key_domain ADD CONSTRAINT key_domain_scope CHECK (
    (kind IN ('work', 'chat', 'files') AND project_id IS NOT NULL AND conversation_id IS NULL)
    OR (kind = 'dm' AND conversation_id IS NOT NULL AND project_id IS NULL)
    OR (kind = 'sprint' AND project_id IS NULL AND conversation_id IS NULL)
);

ALTER TABLE attachment
    ADD COLUMN body_encrypted boolean NOT NULL DEFAULT false,
    ADD COLUMN body_signer_device_id uuid REFERENCES device(id) ON DELETE SET NULL;

-- An encrypted body is bigger than the file by a 187-byte header and 17 bytes
-- per 256 KiB record; the exact relation is checked by the API.
ALTER TABLE attachment DROP CONSTRAINT attachment_size_limit;
ALTER TABLE attachment ADD CONSTRAINT attachment_size_limit CHECK (
    (NOT body_encrypted AND declared_size BETWEEN 1 AND 500000000)
    OR (body_encrypted AND declared_size BETWEEN 205 AND 500100000)
);

-- +goose Down
ALTER TABLE key_domain DROP CONSTRAINT key_domain_scope;
ALTER TABLE key_domain ADD CONSTRAINT key_domain_scope CHECK (
    (kind IN ('work', 'chat') AND project_id IS NOT NULL AND conversation_id IS NULL)
    OR (kind = 'dm' AND conversation_id IS NOT NULL AND project_id IS NULL)
    OR (kind = 'sprint' AND project_id IS NULL AND conversation_id IS NULL)
);
ALTER TABLE attachment DROP CONSTRAINT attachment_size_limit;
ALTER TABLE attachment ADD CONSTRAINT attachment_size_limit CHECK (declared_size BETWEEN 1 AND 500000000);
ALTER TABLE attachment DROP COLUMN body_encrypted, DROP COLUMN body_signer_device_id;
ALTER TABLE key_domain DROP CONSTRAINT key_domain_kind;
ALTER TABLE key_domain ADD CONSTRAINT key_domain_kind CHECK (kind IN ('work', 'chat', 'dm', 'sprint'));
