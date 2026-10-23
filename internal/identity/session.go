package identity

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"time"
)

const SessionLifetime = 7 * 24 * time.Hour
const SessionIdleLifetime = 24 * time.Hour
const sessionSecretBytes = 32

type IssuedSession struct {
	Token     string
	TokenHash [32]byte
	CSRFToken string
	CSRFHash  [32]byte
	ExpiresAt time.Time
}

func IssueSession(now time.Time) (IssuedSession, error) {
	token, tokenHash, err := issueSessionSecret()
	if err != nil {
		return IssuedSession{}, fmt.Errorf("issue session token: %w", err)
	}
	csrfToken, csrfHash, err := issueSessionSecret()
	if err != nil {
		return IssuedSession{}, fmt.Errorf("issue CSRF token: %w", err)
	}
	return IssuedSession{
		Token: token, TokenHash: tokenHash, CSRFToken: csrfToken, CSRFHash: csrfHash,
		ExpiresAt: now.Add(SessionLifetime),
	}, nil
}

func HashSessionToken(raw string) ([32]byte, bool) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(decoded) != sessionSecretBytes || base64.RawURLEncoding.EncodeToString(decoded) != raw {
		return [32]byte{}, false
	}
	return sha256.Sum256([]byte(raw)), true
}

func VerifyCSRFToken(raw string, expected []byte) bool {
	if len(expected) != sha256.Size {
		return false
	}
	hash, ok := HashSessionToken(raw)
	return ok && subtle.ConstantTimeCompare(hash[:], expected) == 1
}

func issueSessionSecret() (string, [sha256.Size]byte, error) {
	var entropy [sessionSecretBytes]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", [sha256.Size]byte{}, err
	}
	raw := base64.RawURLEncoding.EncodeToString(entropy[:])
	return raw, sha256.Sum256([]byte(raw)), nil
}
