-- +goose Up
-- Who may see encrypted history is decided when someone is invited:
--   ask  : the person is asked to set up a key in the browser (the default)
--   auto : the invitation carries what the browser needs, so nothing is asked
--   none : the person never sees the step; they can ask for access later
ALTER TABLE organization_invitation
    ADD COLUMN history_mode text NOT NULL DEFAULT 'ask',
    ADD CONSTRAINT organization_invitation_history_mode CHECK (history_mode IN ('ask', 'auto', 'none'));
ALTER TABLE organization_membership
    ADD COLUMN history_mode text NOT NULL DEFAULT 'ask',
    ADD CONSTRAINT organization_membership_history_mode CHECK (history_mode IN ('ask', 'auto', 'none'));
-- Sealed like the token and erased as soon as the e-mail is sent or the invitation is used.
ALTER TABLE invitation_delivery ADD COLUMN extra_ciphertext bytea;
-- A device registered through an invitation proves it knows the invitation's secret.
ALTER TABLE device ADD COLUMN proof text;

-- +goose Down
ALTER TABLE device DROP COLUMN proof;
ALTER TABLE invitation_delivery DROP COLUMN extra_ciphertext;
ALTER TABLE organization_membership DROP CONSTRAINT organization_membership_history_mode, DROP COLUMN history_mode;
ALTER TABLE organization_invitation DROP CONSTRAINT organization_invitation_history_mode, DROP COLUMN history_mode;
