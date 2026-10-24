package identity

import (
	"bytes"
	"errors"
	"testing"
)

func TestInvitationDeliveryEncryptionRoundTrip(t *testing.T) {
	t.Parallel()
	key := bytes.Repeat([]byte{0x42}, InvitationDeliveryKeySize)
	sealed, err := SealInvitationToken(key, "synthetic-invitation-token")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("synthetic-invitation-token")) {
		t.Fatal("sealed delivery contains plaintext token")
	}
	opened, err := OpenInvitationToken(key, sealed)
	if err != nil || opened != "synthetic-invitation-token" {
		t.Fatalf("open delivery: token=%q err=%v", opened, err)
	}

	sealed[len(sealed)-1] ^= 1
	if _, err := OpenInvitationToken(key, sealed); !errors.Is(err, ErrInvalidInvitationDelivery) {
		t.Fatalf("tampered delivery accepted: %v", err)
	}
}

func TestInvitationDeliveryEncryptionRejectsInvalidInput(t *testing.T) {
	t.Parallel()
	validKey := bytes.Repeat([]byte{0x42}, InvitationDeliveryKeySize)
	for _, test := range []struct {
		name  string
		key   []byte
		token string
	}{
		{name: "short key", key: []byte("short"), token: "token"},
		{name: "empty token", key: validKey, token: ""},
		{name: "long token", key: validKey, token: string(bytes.Repeat([]byte{'x'}, 513))},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := SealInvitationToken(test.key, test.token); !errors.Is(err, ErrInvalidInvitationDelivery) {
				t.Fatalf("invalid input accepted: %v", err)
			}
		})
	}
	if _, err := OpenInvitationToken(validKey, []byte{1}); !errors.Is(err, ErrInvalidInvitationDelivery) {
		t.Fatalf("truncated delivery accepted: %v", err)
	}
}
