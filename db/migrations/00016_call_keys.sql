-- +goose Up
-- End-to-end encryption of call media. A call key is ephemeral: it exists only
-- as envelopes sealed for the devices that currently hold a seat, and it is
-- renewed whenever the set of seated devices changes.

ALTER TABLE call_admission ADD COLUMN device_id uuid REFERENCES device(id) ON DELETE SET NULL;
ALTER TABLE call ADD COLUMN key_generation integer NOT NULL DEFAULT 0;

CREATE TABLE call_key_generation (
    call_id uuid NOT NULL REFERENCES call(id) ON DELETE CASCADE,
    generation integer NOT NULL,
    created_by_device uuid REFERENCES device(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (call_id, generation),
    CONSTRAINT call_key_generation_positive CHECK (generation >= 1)
);

CREATE TABLE call_key_envelope (
    call_id uuid NOT NULL,
    generation integer NOT NULL,
    recipient_device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
    signer_device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
    sealed bytea NOT NULL,
    signature bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (call_id, generation, recipient_device_id),
    FOREIGN KEY (call_id, generation) REFERENCES call_key_generation (call_id, generation) ON DELETE CASCADE,
    CONSTRAINT call_key_envelope_sizes CHECK (octet_length(sealed) BETWEEN 48 AND 1024 AND octet_length(signature) = 64)
);

CREATE INDEX call_key_envelope_recipient_idx ON call_key_envelope (recipient_device_id);

-- +goose Down
DROP TABLE call_key_envelope;
DROP TABLE call_key_generation;
ALTER TABLE call DROP COLUMN key_generation;
ALTER TABLE call_admission DROP COLUMN device_id;
