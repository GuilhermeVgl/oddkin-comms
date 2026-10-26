-- +goose Up
-- Profile photos are small, already resized by the browser, and stay with the
-- account (they are identity data, like the e-mail, not encrypted content).
CREATE TABLE account_avatar (
    account_id uuid PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
    content_type text NOT NULL,
    data bytea NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT account_avatar_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT account_avatar_size CHECK (octet_length(data) BETWEEN 1 AND 262144)
);

-- +goose Down
DROP TABLE account_avatar;
