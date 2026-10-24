-- +goose Up
ALTER TABLE organization_invitation
    ADD COLUMN requested_by uuid REFERENCES account(id) ON DELETE SET NULL,
    ADD COLUMN revoked_at timestamptz;

CREATE TABLE invitation_delivery (
    invitation_id uuid PRIMARY KEY REFERENCES organization_invitation(id) ON DELETE CASCADE,
    token_ciphertext bytea NOT NULL,
    state text NOT NULL DEFAULT 'pending',
    provider_id text,
    sent_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT invitation_delivery_ciphertext_not_empty CHECK (octet_length(token_ciphertext) > 0),
    CONSTRAINT invitation_delivery_state CHECK (state IN ('pending', 'sent', 'failed', 'cancelled')),
    CONSTRAINT invitation_delivery_sent_consistent CHECK (
        (state = 'sent' AND provider_id IS NOT NULL AND sent_at IS NOT NULL)
        OR (state <> 'sent' AND sent_at IS NULL)
    )
);

CREATE INDEX organization_invitation_recipient_idx
    ON organization_invitation (organization_id, email_normalized, created_at DESC);
CREATE UNIQUE INDEX organization_invitation_one_pending_recipient
    ON organization_invitation (organization_id, email_normalized)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- +goose Down
DROP INDEX organization_invitation_recipient_idx;
DROP INDEX organization_invitation_one_pending_recipient;
DROP TABLE invitation_delivery;
ALTER TABLE organization_invitation
    DROP COLUMN revoked_at,
    DROP COLUMN requested_by;
