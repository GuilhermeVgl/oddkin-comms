package resendmail

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSendPostsTransactionalEmailToResend(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/emails" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer synthetic_test_key" ||
			r.Header.Get("Content-Type") != "application/json" ||
			r.Header.Get("Idempotency-Key") != "invitation/00000000-0000-4000-8000-000000000001" ||
			r.Header.Get("User-Agent") == "" {
			t.Errorf("missing required Resend headers")
		}
		var body struct {
			From    string   `json:"from"`
			To      []string `json:"to"`
			Subject string   `json:"subject"`
			Text    string   `json:"text"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error("decode Resend request:", err)
		}
		if body.From != "notices@example.test" || len(body.To) != 1 || body.To[0] != "person@example.test" ||
			body.Subject != "Convite ODDKIN" || body.Text != "Aceite seu convite." {
			t.Errorf("unexpected email payload: %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}`))
	}))
	defer server.Close()
	client, err := New("synthetic_test_key", "notices@example.test")
	if err != nil {
		t.Fatal(err)
	}
	client.endpoint = server.URL + "/emails"
	id, err := client.Send(context.Background(), Message{
		To: "person@example.test", Subject: "Convite ODDKIN", Text: "Aceite seu convite.",
		IdempotencyKey: "invitation/00000000-0000-4000-8000-000000000001",
	})
	if err != nil || id != "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" {
		t.Fatalf("send result: id=%q err=%v", id, err)
	}
}

func TestSendRejectsInvalidDataBeforeNetwork(t *testing.T) {
	t.Parallel()
	for _, config := range []struct{ key, from string }{
		{"", "notices@example.test"}, {"synthetic_test_key", ""},
		{"synthetic_test_key\r\nInjected: x", "notices@example.test"},
	} {
		if client, err := New(config.key, config.from); err == nil || client != nil {
			t.Errorf("invalid config accepted: client=%v err=%v", client, err)
		}
	}
	for _, endpoint := range []string{"", "://bad", "ftp://example.test/emails", "https://user@example.test/emails", "https://example.test/emails?key=value"} {
		if client, err := NewWithEndpoint("synthetic_test_key", "notices@example.test", endpoint); err == nil || client != nil {
			t.Errorf("invalid endpoint accepted: %q", endpoint)
		}
	}
	client, err := New("synthetic_test_key", "notices@example.test")
	if err != nil {
		t.Fatal(err)
	}
	client.endpoint = "http://127.0.0.1:1/emails"
	valid := Message{To: "person@example.test", Subject: "Convite ODDKIN", Text: "Aceite seu convite.", IdempotencyKey: "invitation/1"}
	for _, change := range []func(*Message){
		func(m *Message) { m.To = "Other <other@example.test>" },
		func(m *Message) { m.Subject = "Hello\r\nBcc: other@example.test" },
		func(m *Message) { m.Subject = "  " },
		func(m *Message) { m.Text = "" },
		func(m *Message) { m.IdempotencyKey = "" },
		func(m *Message) { m.IdempotencyKey = strings.Repeat("x", 257) },
	} {
		message := valid
		change(&message)
		if id, err := client.Send(context.Background(), message); err == nil || id != "" {
			t.Errorf("invalid message accepted: id=%q err=%v", id, err)
		}
	}
}

func TestSendClassifiesProviderFailuresWithoutLeakingBodies(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		status    int
		retryable bool
	}{
		{http.StatusBadRequest, false},
		{http.StatusTooManyRequests, true},
		{http.StatusServiceUnavailable, true},
	} {
		t.Run(http.StatusText(test.status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte("synthetic_test_key person@example.test"))
			}))
			defer server.Close()
			client, err := New("synthetic_test_key", "notices@example.test")
			if err != nil {
				t.Fatal(err)
			}
			client.endpoint = server.URL + "/emails"
			_, err = client.Send(context.Background(), Message{
				To: "person@example.test", Subject: "Convite ODDKIN", Text: "Aceite seu convite.", IdempotencyKey: "invitation/1",
			})
			if err == nil || strings.Contains(err.Error(), "synthetic_test_key") || strings.Contains(err.Error(), "person@example.test") {
				t.Fatalf("unsafe error: %v", err)
			}
			var sendErr *SendError
			if !errors.As(err, &sendErr) || sendErr.StatusCode != test.status || sendErr.Retryable != test.retryable {
				t.Fatalf("unexpected error classification: %v", err)
			}
		})
	}
}

func TestSendHandlesIdempotencyConflictAndAmbiguousDelivery(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name      string
		status    int
		body      string
		retryable bool
	}{
		{"concurrent request", http.StatusConflict, `{"name":"concurrent_idempotent_requests"}`, true},
		{"changed payload", http.StatusConflict, `{"name":"invalid_idempotent_request"}`, false},
		{"malformed success", http.StatusOK, `{"id":""}`, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			client, err := New("synthetic_test_key", "notices@example.test")
			if err != nil {
				t.Fatal(err)
			}
			client.endpoint = server.URL + "/emails"
			_, err = client.Send(context.Background(), Message{
				To: "person@example.test", Subject: "Convite ODDKIN", Text: "Aceite seu convite.", IdempotencyKey: "invitation/1",
			})
			var sendErr *SendError
			if !errors.As(err, &sendErr) || sendErr.Retryable != test.retryable {
				t.Fatalf("unexpected error classification: %v", err)
			}
		})
	}
}

func TestSendRespectsCancellation(t *testing.T) {
	t.Parallel()
	client, err := New("synthetic_test_key", "notices@example.test")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = client.Send(ctx, Message{
		To: "person@example.test", Subject: "Convite ODDKIN", Text: "Aceite seu convite.", IdempotencyKey: "invitation/1",
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled request should not proceed: %v", err)
	}
}
