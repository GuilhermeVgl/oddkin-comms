package identity

import (
	"strings"
	"testing"
)

func TestNormalizeEmailForInvitationAndAccountMatching(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name  string
		input string
		want  string
	}{
		{name: "already normalized", input: "person@example.test", want: "person@example.test"},
		{name: "case and surrounding whitespace", input: "  Person@Example.TEST  ", want: "person@example.test"},
		{name: "plus addressing", input: "Person+Work@Example.test", want: "person+work@example.test"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := NormalizeEmail(test.input)
			if err != nil || got != test.want {
				t.Fatalf("NormalizeEmail(%q) = %q, %v; want %q", test.input, got, err, test.want)
			}
		})
	}
}

func TestNormalizeEmailRejectsAmbiguousOrUnsafeRecipients(t *testing.T) {
	t.Parallel()
	for _, input := range []string{
		"", "  ", "person", "person@", "@example.test", "person@@example.test",
		"Person <person@example.test>", "person@example.test,other@example.test",
		"person@example.test\r\nBcc: other@example.test", "person name@example.test",
		"ação@example.test", strings.Repeat("a", 243) + "@example.test",
	} {
		t.Run(input, func(t *testing.T) {
			t.Parallel()
			if got, err := NormalizeEmail(input); err == nil || got != "" {
				t.Errorf("invalid recipient %q accepted as %q (error %v)", input, got, err)
			}
		})
	}
}
