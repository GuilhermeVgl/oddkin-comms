package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/GuilhermeVgl/crewstead-comms/internal/platform/resendmail"
)

type recordingSender struct {
	calls   int
	message resendmail.Message
	err     error
}

func (sender *recordingSender) Send(_ context.Context, message resendmail.Message) (string, error) {
	sender.calls++
	sender.message = message
	return "synthetic-message-id", sender.err
}

func TestDiagnosticMessageUsesFixedContentAndUniqueKey(t *testing.T) {
	t.Parallel()
	sender := &recordingSender{}
	id, err := sendDiagnostic(context.Background(), " Person@Example.TEST ", sender)
	if err != nil || id != "synthetic-message-id" || sender.calls != 1 {
		t.Fatalf("diagnostic send: id=%q calls=%d err=%v", id, sender.calls, err)
	}
	first := sender.message
	if first.To != "person@example.test" || first.Subject != "Crewstead: teste de e-mail" ||
		!strings.Contains(first.Text, "teste") || !strings.HasPrefix(first.IdempotencyKey, "email-smoke/") {
		t.Fatalf("unexpected diagnostic message: %+v", first)
	}
	_, err = sendDiagnostic(context.Background(), "person@example.test", sender)
	if err != nil || sender.message.IdempotencyKey == first.IdempotencyKey {
		t.Fatalf("new diagnostic run must use a new idempotency key: %v", err)
	}
}

func TestDiagnosticRejectsInvalidRecipientAndHidesProviderError(t *testing.T) {
	t.Parallel()
	sender := &recordingSender{}
	if _, err := sendDiagnostic(context.Background(), "Other <other@example.test>", sender); err == nil || sender.calls != 0 {
		t.Fatalf("invalid recipient reached provider: calls=%d err=%v", sender.calls, err)
	}
	sender.err = errors.New("synthetic secret and email leaked by provider")
	if _, err := sendDiagnostic(context.Background(), "person@example.test", sender); err == nil ||
		strings.Contains(err.Error(), "synthetic secret") || strings.Contains(err.Error(), "person@example.test") {
		t.Fatalf("unsafe diagnostic error: %v", err)
	}
}

func TestDiagnosticRequiresConfigBeforeSending(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("RESEND_FROM_EMAIL", "")
	if err := run(context.Background(), "person@example.test"); err == nil ||
		!strings.Contains(err.Error(), "RESEND_API_KEY") {
		t.Fatalf("missing configuration accepted: %v", err)
	}
}
