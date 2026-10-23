package identity

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

var ErrInvalidPassword = errors.New("invalid password")

const (
	passwordMemory  = 19 * 1024 // KiB
	passwordPasses  = 2
	passwordThreads = 1
	passwordSaltLen = 16
	passwordKeyLen  = 32
)

// HashPassword stores the cost parameters alongside a fresh salt and Argon2id hash.
func HashPassword(password string) (string, error) {
	if !validPassword(password) {
		return "", ErrInvalidPassword
	}
	salt := make([]byte, passwordSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, passwordPasses, passwordMemory, passwordThreads, passwordKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, passwordMemory, passwordPasses, passwordThreads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword bounds stored cost parameters before allocating Argon2 memory.
func VerifyPassword(password, encoded string) bool {
	if !validPassword(password) || len(encoded) > 256 {
		return false
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	var memory uint64
	var passes, threads uint64
	parameters := strings.Split(parts[3], ",")
	if len(parameters) != 3 {
		return false
	}
	var ok bool
	if memory, ok = parseCost(parameters[0], "m="); !ok || memory < passwordMemory || memory > 64*1024 {
		return false
	}
	if passes, ok = parseCost(parameters[1], "t="); !ok || passes < passwordPasses || passes > 6 {
		return false
	}
	if threads, ok = parseCost(parameters[2], "p="); !ok || threads < 1 || threads > 4 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) != passwordSaltLen || base64.RawStdEncoding.EncodeToString(salt) != parts[4] {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) != passwordKeyLen || base64.RawStdEncoding.EncodeToString(expected) != parts[5] {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, uint32(passes), uint32(memory), uint8(threads), passwordKeyLen)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func validPassword(password string) bool {
	return utf8.ValidString(password) && utf8.RuneCountInString(password) >= 12 && len(password) <= 1024
}

func parseCost(raw, prefix string) (uint64, bool) {
	value, found := strings.CutPrefix(raw, prefix)
	if !found || value == "" || (len(value) > 1 && value[0] == '0') {
		return 0, false
	}
	parsed, err := strconv.ParseUint(value, 10, 32)
	return parsed, err == nil && strconv.FormatUint(parsed, 10) == value
}
