-- +goose Up
CREATE TABLE organization_trust (
    organization_id uuid PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
    root_sign_public_key bytea NOT NULL,
    set_by uuid REFERENCES account(id) ON DELETE SET NULL,
    set_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT organization_trust_key_length CHECK (octet_length(root_sign_public_key) = 32)
);

CREATE TABLE device (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    kind text NOT NULL DEFAULT 'device',
    name text NOT NULL,
    sign_public_key bytea NOT NULL,
    box_public_key bytea NOT NULL,
    state text NOT NULL DEFAULT 'pending',
    certificate bytea,
    authorizer_device_id uuid REFERENCES device(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    authorized_at timestamptz,
    revoked_at timestamptz,
    CONSTRAINT device_kind CHECK (kind IN ('device', 'recovery')),
    CONSTRAINT device_state CHECK (state IN ('pending', 'active', 'revoked')),
    CONSTRAINT device_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT device_key_lengths CHECK (octet_length(sign_public_key) = 32 AND octet_length(box_public_key) = 32),
    CONSTRAINT device_active_has_certificate CHECK (state <> 'active' OR (certificate IS NOT NULL AND octet_length(certificate) = 64))
);

CREATE UNIQUE INDEX device_sign_key_idx ON device (sign_public_key) WHERE state <> 'revoked';
CREATE INDEX device_account_idx ON device (account_id) WHERE state <> 'revoked';

CREATE TABLE key_domain (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    kind text NOT NULL,
    current_generation integer NOT NULL DEFAULT 0,
    state text NOT NULL DEFAULT 'pending_keys',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, kind),
    CONSTRAINT key_domain_kind CHECK (kind IN ('work', 'chat')),
    CONSTRAINT key_domain_state CHECK (state IN ('ok', 'pending_keys', 'rotation_required'))
);

CREATE TABLE key_generation (
    domain_id uuid NOT NULL REFERENCES key_domain(id) ON DELETE CASCADE,
    generation integer NOT NULL,
    created_by_device uuid REFERENCES device(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (domain_id, generation),
    CONSTRAINT key_generation_positive CHECK (generation >= 1)
);

CREATE TABLE key_envelope (
    domain_id uuid NOT NULL,
    generation integer NOT NULL,
    recipient_device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
    signer_device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
    sealed bytea NOT NULL,
    signature bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (domain_id, generation, recipient_device_id),
    FOREIGN KEY (domain_id, generation) REFERENCES key_generation (domain_id, generation) ON DELETE CASCADE,
    CONSTRAINT key_envelope_sizes CHECK (octet_length(sealed) BETWEEN 48 AND 1024 AND octet_length(signature) = 64)
);

CREATE INDEX key_envelope_recipient_idx ON key_envelope (recipient_device_id);

-- +goose Down
DROP TABLE key_envelope;
DROP TABLE key_generation;
DROP TABLE key_domain;
DROP TABLE device;
DROP TABLE organization_trust;
