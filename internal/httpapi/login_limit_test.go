package httpapi

import (
	"fmt"
	"testing"
	"time"
)

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
