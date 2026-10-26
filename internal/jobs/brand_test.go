package jobs

import "testing"

func TestAppDisplayNameFallsBackForInvalidMailHeaderValue(t *testing.T) {
	t.Setenv("APP_DISPLAY_NAME", "  Outra Marca  ")
	if got := appDisplayName(); got != "Outra Marca" {
		t.Fatalf("configured name: %q", got)
	}
	t.Setenv("APP_DISPLAY_NAME", "Marca\r\nBcc: attacker@example.test")
	if got := appDisplayName(); got != "Crewstead" {
		t.Fatalf("header injection accepted: %q", got)
	}
}
