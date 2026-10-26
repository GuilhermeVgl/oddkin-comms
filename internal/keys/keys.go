// Package keys verifies, on the server, the signatures of the end-to-end
// encryption protocol (see docs/adr/0015-e2ee-key-directory.md). The server
// never sees plaintext or secret keys: it only checks that directory entries
// and key envelopes were signed by the devices they claim to come from, so it
// cannot be tricked, and cannot trick others, into accepting a forged entry.
package keys

import (
	"crypto/ed25519"
	"encoding/binary"
)

// lengthPrefixed mirrors packages/crypto: every field carries a 32-bit length,
// which makes the concatenation unambiguous.
func lengthPrefixed(fields ...[]byte) []byte {
	var out []byte
	for _, field := range fields {
		var prefix [4]byte
		binary.BigEndian.PutUint32(prefix[:], uint32(len(field)))
		out = append(out, prefix[:]...)
		out = append(out, field...)
	}
	return out
}

// DeviceCertificate describes the keys a signer vouches for.
type DeviceCertificate struct {
	AccountID     string
	DeviceID      string
	SignPublicKey []byte
	BoxPublicKey  []byte
}

// DeviceCertificateBytes is the exact byte string signed by the trust root or
// by an already authorized device of the same account.
func DeviceCertificateBytes(c DeviceCertificate) []byte {
	return lengthPrefixed([]byte("crewstead/v1/device-cert"), []byte(c.AccountID), []byte(c.DeviceID), c.SignPublicKey, c.BoxPublicKey)
}

// VerifyDeviceCertificate reports whether signature is signerPublicKey's
// signature over the certificate. Malformed keys verify as false.
func VerifyDeviceCertificate(signerPublicKey ed25519.PublicKey, c DeviceCertificate, signature []byte) bool {
	if len(signerPublicKey) != ed25519.PublicKeySize || len(signature) != ed25519.SignatureSize ||
		len(c.SignPublicKey) != ed25519.PublicKeySize || len(c.BoxPublicKey) != 32 {
		return false
	}
	return ed25519.Verify(signerPublicKey, DeviceCertificateBytes(c), signature)
}

// KeyEnvelope identifies a sealed domain key addressed to one device.
type KeyEnvelope struct {
	RecipientDeviceID string
	DomainID          string
	Generation        uint32
	Sealed            []byte
}

// KeyEnvelopeBytes is the exact byte string signed by the sending device.
func KeyEnvelopeBytes(e KeyEnvelope) []byte {
	var generation [4]byte
	binary.BigEndian.PutUint32(generation[:], e.Generation)
	return lengthPrefixed([]byte("crewstead/v1/key-sig"), []byte(e.RecipientDeviceID), []byte(e.DomainID), generation[:], e.Sealed)
}

// VerifyKeyEnvelope checks the sender's signature over the envelope metadata
// and sealed bytes, binding it to one recipient, domain and generation.
func VerifyKeyEnvelope(signerPublicKey ed25519.PublicKey, e KeyEnvelope, signature []byte) bool {
	if len(signerPublicKey) != ed25519.PublicKeySize || len(signature) != ed25519.SignatureSize || len(e.Sealed) == 0 {
		return false
	}
	return ed25519.Verify(signerPublicKey, KeyEnvelopeBytes(e), signature)
}

// ContentMetadata is the authenticated context of an encrypted record. The
// server knows all of these fields as operational metadata.
type ContentMetadata struct {
	OrganizationID string
	DomainID       string
	ResourceID     string
	AuthorID       string
	Revision       uint64
}

const contentHeaderLength = 2 + 4 + 24

// ContentSignedBytes is the exact byte string the author's device signs for a
// content envelope: label, header, authenticated context and ciphertext.
func ContentSignedBytes(m ContentMetadata, header, ciphertext []byte) []byte {
	aad := lengthPrefixed([]byte("crewstead/v1/content"), []byte(m.OrganizationID), []byte(m.DomainID), []byte(m.ResourceID), []byte(m.AuthorID), []byte(uitoa(m.Revision)))
	return lengthPrefixed([]byte("crewstead/v1/content-sig"), header, aad, ciphertext)
}

// VerifyContentEnvelope checks the author's signature of a content envelope
// (header || ciphertext || signature) for the given context, without being
// able to read it. It lets the server refuse records not signed by their
// claimed author's device.
func VerifyContentEnvelope(signerPublicKey ed25519.PublicKey, m ContentMetadata, envelope []byte) bool {
	if len(signerPublicKey) != ed25519.PublicKeySize || len(envelope) < contentHeaderLength+16+ed25519.SignatureSize {
		return false
	}
	if envelope[0] != 1 || envelope[1] != 1 {
		return false
	}
	body := envelope[:len(envelope)-ed25519.SignatureSize]
	signature := envelope[len(envelope)-ed25519.SignatureSize:]
	return ed25519.Verify(signerPublicKey, ContentSignedBytes(m, body[:contentHeaderLength], body[contentHeaderLength:]), signature)
}

// EnvelopeGeneration returns the key generation declared in a content
// envelope header, so the server can reject writes with a stale generation.
func EnvelopeGeneration(envelope []byte) (uint32, bool) {
	if len(envelope) < 6 || envelope[0] != 1 || envelope[1] != 1 {
		return 0, false
	}
	return binary.BigEndian.Uint32(envelope[2:6]), true
}

func uitoa(value uint64) string {
	if value == 0 {
		return "0"
	}
	var digits [20]byte
	index := len(digits)
	for value > 0 {
		index--
		digits[index] = byte('0' + value%10)
		value /= 10
	}
	return string(digits[index:])
}
