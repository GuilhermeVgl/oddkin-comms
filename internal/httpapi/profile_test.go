package httpapi

import (
	"strings"
	"testing"
)

func TestNormalizeDisplayName(t *testing.T) {
	for _, test := range []struct {
		raw  string
		want string
		ok   bool
	}{
		{"Ana Silva", "Ana Silva", true},
		{"", "", false},
		{" Ana", "Ana", false},
		{strings.Repeat("á", 80), strings.Repeat("á", 80), true},
		{strings.Repeat("a", 81), strings.Repeat("a", 81), false},
	} {
		got, ok := normalizeDisplayName(test.raw)
		if got != test.want || ok != test.ok {
			t.Fatalf("normalizeDisplayName(%q) = %q, %v", test.raw, got, ok)
		}
	}
}
