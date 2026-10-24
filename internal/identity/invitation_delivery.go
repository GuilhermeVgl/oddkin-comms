package identity

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"io"
)

const InvitationDeliveryKeySize = 32

const invitationDeliveryVersion byte = 1

var ErrInvalidInvitationDelivery = errors.New("invalid invitation delivery")

func SealInvitationToken(key []byte, token string) ([]byte, error) {
	if len(key) != InvitationDeliveryKeySize || token == "" || len(token) > 512 {
		return nil, ErrInvalidInvitationDelivery
	}
	aead, err := invitationAEAD(key)
	if err != nil {
		return nil, ErrInvalidInvitationDelivery
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, ErrInvalidInvitationDelivery
	}
	sealed := make([]byte, 1, 1+len(nonce)+len(token)+aead.Overhead())
	sealed[0] = invitationDeliveryVersion
	sealed = append(sealed, nonce...)
	return aead.Seal(sealed, nonce, []byte(token), invitationDeliveryAAD), nil
}

func OpenInvitationToken(key, sealed []byte) (string, error) {
	aead, err := invitationAEAD(key)
	if err != nil || len(sealed) < 1+aead.NonceSize()+aead.Overhead() || sealed[0] != invitationDeliveryVersion {
		return "", ErrInvalidInvitationDelivery
	}
	nonce := sealed[1 : 1+aead.NonceSize()]
	plaintext, err := aead.Open(nil, nonce, sealed[1+aead.NonceSize():], invitationDeliveryAAD)
	if err != nil || len(plaintext) == 0 || len(plaintext) > 512 {
		return "", ErrInvalidInvitationDelivery
	}
	return string(plaintext), nil
}

var invitationDeliveryAAD = []byte("oddkin/invitation-delivery/v1")

func invitationAEAD(key []byte) (cipher.AEAD, error) {
	if len(key) != InvitationDeliveryKeySize {
		return nil, ErrInvalidInvitationDelivery
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
