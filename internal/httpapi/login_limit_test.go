package httpapi

import (
	"fmt"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLoginClientAddressOnlyAcceptsLoopbackProxy(t *testing.T) {
	request := httptest.NewRequest("POST", "http://example.test/", nil)
	request.Header.Set("X-Crewstead-Client-IP", "203.0.113.7")
	request.RemoteAddr = "127.0.0.1:1234"
	if got := loginClientAddress(request); got != "203.0.113.7" {
		t.Fatalf("trusted proxy: %s", got)
	}
	request.RemoteAddr = "198.51.100.10:1234"
	if got := loginClientAddress(request); got != "198.51.100.10" {
		t.Fatalf("untrusted client: %s", got)
	}
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("X-Crewstead-Client-IP", "bad, 203.0.113.7")
	if got := loginClientAddress(request); got != "127.0.0.1" {
		t.Fatalf("invalid address: %s", got)
	}
}

func TestLoginLimiterBlocksRepeatedFailuresAndRecovers(t *testing.T) {
	limiter := newLoginLimiter()
	now := time.Date(2026, 10, 23, 20, 0, 0, 0, time.UTC)
	for range 5 {
		if !limiter.allow("account@example.test", 5, now) {
			t.Fatal("attempt blocked before threshold")
		}
		limiter.fail("account@example.test", 5, now)
	}
	if limiter.allow("account@example.test", 5, now.Add(time.Second)) {
		t.Fatal("repeated failures did not block login")
	}
	if !limiter.allow("account@example.test", 5, now.Add(3*time.Second)) {
		t.Fatal("initial block lasted too long")
	}
	limiter.fail("account@example.test", 5, now.Add(3*time.Second))
	if limiter.allow("account@example.test", 5, now.Add(6*time.Second)) {
		t.Fatal("subsequent failure did not increase delay")
	}
	if !limiter.allow("account@example.test", 5, now.Add(8*time.Second)) {
		t.Fatal("progressive block lasted too long")
	}
	limiter.succeed("account@example.test")
	if !limiter.allow("account@example.test", 5, now.Add(8*time.Second)) {
		t.Fatal("successful login did not reset account limit")
	}
	limiter.fail("account@example.test", 5, now)
	if !limiter.allow("account@example.test", 5, now.Add(11*time.Minute)) {
		t.Fatal("old failures did not expire")
	}
}

func TestLoginLimiterPrunesExpiredEntriesAtCapacity(t *testing.T) {
	t.Parallel()
	limiter := newLoginLimiter()
	now := time.Date(2026, 10, 23, 20, 0, 0, 0, time.UTC)
	for index := range maxLoginLimitEntries {
		limiter.attempts[fmt.Sprintf("expired-%d", index)] = loginAttempt{resetAt: now.Add(-time.Second)}
	}
	if !limiter.allow("new-address", 5, now) || len(limiter.attempts) != 0 {
		t.Fatalf("expired entries were not pruned: count=%d", len(limiter.attempts))
	}
}
