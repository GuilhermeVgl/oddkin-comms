package identity

import (
	"strings"
	"testing"
)

func TestPasswordHashAndVerification(t *testing.T) {
	password := "uma frase longa de teste"
	first, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	second, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if first == second || strings.Contains(first, password) {
		t.Fatal("password hashes must use distinct salts and never contain plaintext")
	}
	if !VerifyPassword(password, first) || VerifyPassword("frase diferente", first) {
		t.Fatal("password verification gave the wrong result")
	}
}

func TestPasswordRejectsInvalidInputsAndUntrustedParameters(t *testing.T) {
	for _, password := range []string{"curta", strings.Repeat("x", 1025), "invalid\xffutf8"} {
		if _, err := HashPassword(password); err == nil {
			t.Errorf("password %q should be rejected", password)
		}
	}
	valid, err := HashPassword("senha suficientemente longa")
	if err != nil {
		t.Fatal(err)
	}
	for _, encoded := range []string{
		"", "plain text", valid + "x",
		strings.Replace(valid, "m=19456", "m=4294967295", 1),
		strings.Replace(valid, "t=2", "t=0", 1),
		strings.Replace(valid, "p=1", "p=0", 1),
	} {
		if VerifyPassword("senha suficientemente longa", encoded) {
			t.Errorf("untrusted password hash must be rejected: %q", encoded)
		}
	}
}
