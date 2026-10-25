package identity

import (
	"bytes"
	"testing"
	"time"
)

func TestResetTokenShapeAndLifetime(t *testing.T) {
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	raw, hash, expires, err := IssueResetToken(now)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != 43 || !expires.Equal(now.Add(time.Hour)) {
		t.Fatalf("token=%q expires=%v", raw, expires)
	}
	checked, ok := HashResetToken(raw)
	if !ok || checked != hash {
		t.Fatal("the stored hash must match the issued token")
	}
	if _, ok := HashResetToken(raw[:42]); ok {
		t.Fatal("a truncated token must be refused before any lookup")
	}
}

func TestSealedTokensStayInTheirOwnPurpose(t *testing.T) {
	key := bytes.Repeat([]byte{7}, InvitationDeliveryKeySize)
	sealed, err := SealResetToken(key, "token-value")
	if err != nil {
		t.Fatal(err)
	}
	if opened, err := OpenResetToken(key, sealed); err != nil || opened != "token-value" {
		t.Fatalf("open reset: %q %v", opened, err)
	}
	if _, err := OpenInvitationToken(key, sealed); err == nil {
		t.Fatal("a reset token must not open as an invitation token")
	}
}
