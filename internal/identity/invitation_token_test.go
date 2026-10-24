package identity

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestInvitationTokenIsRandomHashedAndExpires(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.October, 23, 12, 0, 0, 0, time.UTC)
	raw, record, err := IssueInvitationToken(now)
	if err != nil {
		t.Fatal("issue invitation token:", err)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(decoded) != 32 {
		t.Fatalf("token must contain 32 URL-safe random bytes, length=%d error=%v", len(decoded), err)
	}
	if record.ExpiresAt != now.Add(InvitationLifetime) {
		t.Fatalf("expiry=%v, want %v", record.ExpiresAt, now.Add(InvitationLifetime))
	}
	if record.Hash != sha256.Sum256([]byte(raw)) {
		t.Fatal("stored hash does not match the token digest")
	}
	if hash, ok := HashInvitationToken(raw); !ok || hash != record.Hash {
		t.Fatal("valid token did not produce its storage hash")
	}
	if !record.Verify(raw, now.Add(InvitationLifetime-time.Nanosecond)) {
		t.Fatal("valid unexpired token rejected")
	}
	if record.Verify(raw, record.ExpiresAt) {
		t.Fatal("token accepted at expiry")
	}
	if record.Verify(raw, record.ExpiresAt.Add(time.Second)) {
		t.Fatal("expired token accepted")
	}
	other, _, err := IssueInvitationToken(now)
	if err != nil {
		t.Fatal("issue second invitation token:", err)
	}
	if other == raw {
		t.Fatal("two invitation tokens are identical")
	}
	if record.Verify(other, now) {
		t.Fatal("unrelated token accepted")
	}
}

type failedEntropy struct{}

func (failedEntropy) Read(_ []byte) (int, error) {
	return 0, errors.New("synthetic entropy failure")
}

func TestInvitationIssuanceFailsClosedWhenEntropyFails(t *testing.T) {
	t.Parallel()
	raw, record, err := issueInvitationTokenWithReader(time.Now(), failedEntropy{})
	if err == nil || raw != "" || record != (InvitationToken{}) {
		t.Fatalf("entropy failure must return no usable token or record: raw=%q record=%v err=%v", raw, record, err)
	}
}

func TestInvitationTokenRejectsMalformedEncoding(t *testing.T) {
	t.Parallel()
	raw, record, err := IssueInvitationToken(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if raw == "" {
		t.Fatal("issued empty token")
	}
	for _, candidate := range []string{"", raw + "=", raw[:len(raw)-1], strings.Repeat("!", len(raw))} {
		if _, ok := HashInvitationToken(candidate); ok {
			t.Errorf("malformed token %q produced a hash", candidate)
		}
		if record.Verify(candidate, time.Now()) {
			t.Errorf("malformed token %q accepted", candidate)
		}
	}
}
