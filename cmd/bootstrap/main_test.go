package main

import (
	"context"
	"strings"
	"testing"
)

func TestRunRequiresBootstrapConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if err := run(context.Background()); err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("missing database URL: %v", err)
	}
	t.Setenv("DATABASE_URL", "postgres://synthetic.invalid/test")
	t.Setenv("ODDKIN_ADMIN_EMAIL", "")
	if err := run(context.Background()); err == nil || !strings.Contains(err.Error(), "ODDKIN_ADMIN_EMAIL") {
		t.Fatalf("missing admin email: %v", err)
	}
	t.Setenv("ODDKIN_ADMIN_EMAIL", "admin@example.test")
	t.Setenv("ODDKIN_ADMIN_PASSWORD", "")
	if err := run(context.Background()); err == nil || !strings.Contains(err.Error(), "ODDKIN_ADMIN_PASSWORD") {
		t.Fatalf("missing admin password: %v", err)
	}
}
