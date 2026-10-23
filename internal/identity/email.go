package identity

import (
	"errors"
	"net/mail"
	"strings"
)

var ErrInvalidEmail = errors.New("invalid email address")

func NormalizeEmail(raw string) (string, error) {
	address := strings.TrimSpace(raw)
	if address == "" || len(address) > 254 || strings.ContainsAny(raw, "\r\n") {
		return "", ErrInvalidEmail
	}
	for i := range len(address) {
		if address[i] >= 128 {
			return "", ErrInvalidEmail
		}
	}
	parsed, err := mail.ParseAddress(address)
	if err != nil || parsed.Address != address || parsed.Name != "" {
		return "", ErrInvalidEmail
	}
	return strings.ToLower(address), nil
}
