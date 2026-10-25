-- +goose Up
-- Single-use password reset links. Only a hash of the token is kept for checking;
-- the sealed copy exists so the e-mail job can build the link and is erased once sent.
CREATE TABLE password_reset (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    token_ciphertext bytea,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT password_reset_hash_length CHECK (octet_length(token_hash) = 32)
);

CREATE INDEX password_reset_account_idx ON password_reset (account_id, created_at DESC);

-- +goose Down
DROP TABLE password_reset;
