package identity

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"time"
)

// ResetLifetime is how long a password reset link stays valid.
const ResetLifetime = time.Hour

// IssueResetToken returns a new single-use token and the hash to store for it.
func IssueResetToken(now time.Time) (raw string, hash [sha256.Size]byte, expiresAt time.Time, err error) {
	var entropy [invitationEntropyBytes]byte
	if _, err = rand.Read(entropy[:]); err != nil {
		return "", hash, time.Time{}, err
	}
	raw = base64.RawURLEncoding.EncodeToString(entropy[:])
	return raw, sha256.Sum256([]byte(raw)), now.Add(ResetLifetime), nil
}

// HashResetToken checks the shape of a token before it is looked up.
func HashResetToken(raw string) ([sha256.Size]byte, bool) {
	return HashInvitationToken(raw)
}
