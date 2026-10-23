-- +goose Up
CREATE TABLE account (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email_normalized text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT account_email_normalized CHECK (
        email_normalized <> '' AND email_normalized = lower(btrim(email_normalized))
    ),
    CONSTRAINT account_password_hash_format CHECK (left(password_hash, 10) = '$argon2id$')
);

CREATE TABLE organization_membership (
    organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    membership_kind text NOT NULL,
    is_admin boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, account_id),
    CONSTRAINT organization_membership_kind CHECK (membership_kind IN ('internal', 'external')),
    CONSTRAINT organization_admin_is_internal CHECK (NOT is_admin OR membership_kind = 'internal')
);

CREATE TABLE auth_session (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    csrf_hash bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CONSTRAINT auth_session_token_hash_length CHECK (octet_length(token_hash) = 32),
    CONSTRAINT auth_session_csrf_hash_length CHECK (octet_length(csrf_hash) = 32),
    CONSTRAINT auth_session_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX auth_session_account_idx ON auth_session (account_id);

-- +goose Down
DROP TABLE auth_session;
DROP TABLE organization_membership;
DROP TABLE account;
