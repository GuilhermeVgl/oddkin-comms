package httpapi

import (
	"sync"
	"time"
)

const loginLimitWindow = 10 * time.Minute
const maxLoginLimitEntries = 10_000

type loginAttempt struct {
	count        int
	resetAt      time.Time
	blockedUntil time.Time
}

type loginLimiter struct {
	mu       sync.Mutex
	attempts map[string]loginAttempt
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{attempts: make(map[string]loginAttempt)}
}

func (l *loginLimiter) allow(key string, _ int, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	state, exists := l.attempts[key]
	if exists && now.Before(state.resetAt) {
		return !now.Before(state.blockedUntil)
	}
	if exists {
		delete(l.attempts, key)
	}
	if len(l.attempts) < maxLoginLimitEntries {
		return true
	}
	l.prune(now)
	return len(l.attempts) < maxLoginLimitEntries
}

func (l *loginLimiter) fail(key string, threshold int, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	state, exists := l.attempts[key]
	if !exists || !now.Before(state.resetAt) {
		state = loginAttempt{resetAt: now.Add(loginLimitWindow)}
	}
	state.count++
	if state.count >= threshold {
		exponent := min(state.count-threshold+1, 6)
		state.blockedUntil = now.Add(time.Duration(1<<exponent) * time.Second)
	}
	if !exists && len(l.attempts) >= maxLoginLimitEntries {
		l.prune(now)
	}
	if exists || len(l.attempts) < maxLoginLimitEntries {
		l.attempts[key] = state
	}
}

func (l *loginLimiter) succeed(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, key)
}

func (l *loginLimiter) prune(now time.Time) {
	for key, state := range l.attempts {
		if !now.Before(state.resetAt) {
			delete(l.attempts, key)
		}
	}
}
