-- +goose Up
CREATE TABLE organization_invitation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    email_normalized text NOT NULL,
    membership_kind text NOT NULL,
    token_hash bytea NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT organization_invitation_email_normalized CHECK (
        email_normalized <> '' AND email_normalized = lower(btrim(email_normalized))
    ),
    CONSTRAINT organization_invitation_membership_kind CHECK (membership_kind IN ('internal', 'external')),
    CONSTRAINT organization_invitation_hash_length CHECK (octet_length(token_hash) = 32),
    CONSTRAINT organization_invitation_token_unique UNIQUE (token_hash)
);

-- +goose Down
DROP TABLE organization_invitation;
