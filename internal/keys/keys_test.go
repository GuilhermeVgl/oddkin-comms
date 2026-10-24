package keys

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
)

type vectors struct {
	RootSignPublicKey   string `json:"rootSignPublicKey"`
	SenderSignPublicKey string `json:"senderSignPublicKey"`
	DeviceCertificate   struct {
		AccountID     string `json:"accountId"`
		DeviceID      string `json:"deviceId"`
		SignPublicKey string `json:"signPublicKey"`
		BoxPublicKey  string `json:"boxPublicKey"`
		Certificate   string `json:"certificate"`
	} `json:"deviceCertificate"`
	ContentEnvelope struct {
		Context struct {
			OrganizationID string `json:"organizationId"`
			DomainID       string `json:"domainId"`
			ResourceID     string `json:"resourceId"`
			AuthorID       string `json:"authorId"`
			Revision       uint64 `json:"revision"`
		} `json:"context"`
		Generation uint32 `json:"generation"`
		Envelope   string `json:"envelope"`
	} `json:"contentEnvelope"`
	KeyEnvelope struct {
		DomainID          string `json:"domainId"`
		Generation        uint32 `json:"generation"`
		RecipientDeviceID string `json:"recipientDeviceId"`
		Sealed            string `json:"sealed"`
		Signature         string `json:"signature"`
	} `json:"keyEnvelope"`
}

func decode(t *testing.T, value string) []byte {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func load(t *testing.T) vectors {
	t.Helper()
	raw, err := os.ReadFile("../../packages/crypto/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

// These tests verify bytes produced by the TypeScript implementation, so the
// two languages are proven to agree on the canonical encodings.
func TestVerifiesTypeScriptDeviceCertificate(t *testing.T) {
	v := load(t)
	certificate := DeviceCertificate{
		AccountID: v.DeviceCertificate.AccountID, DeviceID: v.DeviceCertificate.DeviceID,
		SignPublicKey: decode(t, v.DeviceCertificate.SignPublicKey), BoxPublicKey: decode(t, v.DeviceCertificate.BoxPublicKey),
	}
	root := ed25519.PublicKey(decode(t, v.RootSignPublicKey))
	signature := decode(t, v.DeviceCertificate.Certificate)
	if !VerifyDeviceCertificate(root, certificate, signature) {
		t.Fatal("certificate signed by TypeScript must verify")
	}
	forged := certificate
	forged.BoxPublicKey = append([]byte(nil), certificate.BoxPublicKey...)
	forged.BoxPublicKey[0] ^= 1
	if VerifyDeviceCertificate(root, forged, signature) {
		t.Fatal("a certificate must not verify for substituted keys")
	}
	forged = certificate
	forged.AccountID = "another-account"
	if VerifyDeviceCertificate(root, forged, signature) {
		t.Fatal("a certificate must not verify for another account")
	}
	if VerifyDeviceCertificate(root, certificate, signature[:10]) || VerifyDeviceCertificate(root[:5], certificate, signature) {
		t.Fatal("malformed input must verify as false, not panic")
	}
}

func TestVerifiesTypeScriptKeyEnvelope(t *testing.T) {
	v := load(t)
	sender := ed25519.PublicKey(decode(t, v.SenderSignPublicKey))
	envelope := KeyEnvelope{
		RecipientDeviceID: v.KeyEnvelope.RecipientDeviceID, DomainID: v.KeyEnvelope.DomainID,
		Generation: v.KeyEnvelope.Generation, Sealed: decode(t, v.KeyEnvelope.Sealed),
	}
	signature := decode(t, v.KeyEnvelope.Signature)
	if !VerifyKeyEnvelope(sender, envelope, signature) {
		t.Fatal("key envelope signed by TypeScript must verify")
	}
	for name, change := range map[string]func(*KeyEnvelope){
		"another recipient":  func(e *KeyEnvelope) { e.RecipientDeviceID = "other-device" },
		"another domain":     func(e *KeyEnvelope) { e.DomainID = "other-domain" },
		"another generation": func(e *KeyEnvelope) { e.Generation++ },
		"modified key bytes": func(e *KeyEnvelope) { e.Sealed = append([]byte{0}, e.Sealed[1:]...) },
	} {
		mutated := envelope
		change(&mutated)
		if VerifyKeyEnvelope(sender, mutated, signature) {
			t.Fatalf("envelope re-labelled as %s must not verify", name)
		}
	}
	if VerifyKeyEnvelope(ed25519.PublicKey(decode(t, v.RootSignPublicKey)), envelope, signature) {
		t.Fatal("a different signer must not verify")
	}
}

func TestVerifiesTypeScriptContentEnvelopeAndBindsContext(t *testing.T) {
	v := load(t)
	sender := ed25519.PublicKey(decode(t, v.SenderSignPublicKey))
	context := ContentMetadata{
		OrganizationID: v.ContentEnvelope.Context.OrganizationID, DomainID: v.ContentEnvelope.Context.DomainID,
		ResourceID: v.ContentEnvelope.Context.ResourceID, AuthorID: v.ContentEnvelope.Context.AuthorID,
		Revision: v.ContentEnvelope.Context.Revision,
	}
	envelope := decode(t, v.ContentEnvelope.Envelope)
	if !VerifyContentEnvelope(sender, context, envelope) {
		t.Fatal("content envelope signed by TypeScript must verify")
	}
	if generation, ok := EnvelopeGeneration(envelope); !ok || generation != v.ContentEnvelope.Generation {
		t.Fatalf("generation: %d %v", generation, ok)
	}
	for name, change := range map[string]func(*ContentMetadata){
		"another record":   func(m *ContentMetadata) { m.ResourceID = "other" },
		"another revision": func(m *ContentMetadata) { m.Revision++ },
		"another domain":   func(m *ContentMetadata) { m.DomainID = "other" },
	} {
		mutated := context
		change(&mutated)
		if VerifyContentEnvelope(sender, mutated, envelope) {
			t.Fatalf("envelope moved to %s must not verify", name)
		}
	}
	tampered := append([]byte(nil), envelope...)
	tampered[40] ^= 1
	if VerifyContentEnvelope(sender, context, tampered) {
		t.Fatal("a modified ciphertext must not verify")
	}
	if VerifyContentEnvelope(sender, context, envelope[:10]) {
		t.Fatal("a truncated envelope must not verify")
	}
}

func TestUitoa(t *testing.T) {
	for value, want := range map[uint64]string{0: "0", 7: "7", 1234567890: "1234567890", 18446744073709551615: "18446744073709551615"} {
		if got := uitoa(value); got != want {
			t.Fatalf("uitoa(%d)=%s", value, got)
		}
	}
}
