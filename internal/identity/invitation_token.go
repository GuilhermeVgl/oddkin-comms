package identity

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"io"
	"time"
)

const InvitationLifetime = 7 * 24 * time.Hour
const invitationEntropyBytes = 32

type InvitationToken struct {
	Hash      [sha256.Size]byte
	ExpiresAt time.Time
}

func IssueInvitationToken(now time.Time) (string, InvitationToken, error) {
	return issueInvitationTokenWithReader(now, rand.Reader)
}

func HashInvitationToken(raw string) ([sha256.Size]byte, bool) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(decoded) != invitationEntropyBytes || base64.RawURLEncoding.EncodeToString(decoded) != raw {
		return [sha256.Size]byte{}, false
	}
	return sha256.Sum256([]byte(raw)), true
}

func issueInvitationTokenWithReader(now time.Time, reader io.Reader) (string, InvitationToken, error) {
	var entropy [invitationEntropyBytes]byte
	if _, err := io.ReadFull(reader, entropy[:]); err != nil {
		return "", InvitationToken{}, err
	}
	raw := base64.RawURLEncoding.EncodeToString(entropy[:])
	return raw, InvitationToken{
		Hash:      sha256.Sum256([]byte(raw)),
		ExpiresAt: now.Add(InvitationLifetime),
	}, nil
}

func (token InvitationToken) Verify(raw string, now time.Time) bool {
	hash, ok := HashInvitationToken(raw)
	if !ok {
		return false
	}
	return subtle.ConstantTimeCompare(hash[:], token.Hash[:]) == 1 && now.Before(token.ExpiresAt)
}
