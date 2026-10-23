package identity

import (
	"testing"
	"time"
)

func TestSessionSecretsAreDistinctAndVerifiable(t *testing.T) {
	now := time.Date(2026, 10, 23, 20, 0, 0, 0, time.UTC)
	first, err := IssueSession(now)
	if err != nil {
		t.Fatal(err)
	}
	second, err := IssueSession(now)
	if err != nil {
		t.Fatal(err)
	}
	if first.Token == first.CSRFToken || first.Token == second.Token || first.CSRFToken == second.CSRFToken {
		t.Fatal("session and CSRF secrets must be independent")
	}
	if !first.ExpiresAt.Equal(now.Add(7 * 24 * time.Hour)) {
		t.Fatalf("unexpected absolute expiry: %s", first.ExpiresAt)
	}
	hash, ok := HashSessionToken(first.Token)
	if !ok || hash != first.TokenHash || !VerifyCSRFToken(first.CSRFToken, first.CSRFHash[:]) {
		t.Fatal("issued session secrets must verify")
	}
	if VerifyCSRFToken(first.Token, first.CSRFHash[:]) || VerifyCSRFToken(second.CSRFToken, first.CSRFHash[:]) {
		t.Fatal("different secrets must not verify")
	}
}

func TestSessionSecretsRejectMalformedValues(t *testing.T) {
	issued, err := IssueSession(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"", "short", issued.Token + "=", issued.Token + "x", "a/b"} {
		if _, ok := HashSessionToken(raw); ok {
			t.Errorf("malformed token accepted: %q", raw)
		}
		if VerifyCSRFToken(raw, issued.CSRFHash[:]) {
			t.Errorf("malformed CSRF token accepted: %q", raw)
		}
	}
	if VerifyCSRFToken(issued.CSRFToken, []byte{1}) {
		t.Fatal("short stored CSRF hash must be rejected")
	}
}
