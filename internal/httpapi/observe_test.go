package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequestsGetACorrelationIDAndLogNoSensitiveData(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/projects/{projectId}", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	handler := withObservability(mux, logger)

	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/6f9619ff-8b86-d011-b42d-00c04fc964ff?token=secret-token", strings.NewReader(`{"password":"hunter2hunter2"}`))
	request.Header.Set("Cookie", "oddkin_session=session-secret")
	result := httptest.NewRecorder()
	handler.ServeHTTP(result, request)

	id := result.Header().Get(requestIDHeader)
	if !validRequestID.MatchString(id) {
		t.Fatalf("response must carry a correlation id, got %q", id)
	}
	line := logs.String()
	for _, secret := range []string{"secret-token", "hunter2", "session-secret", "6f9619ff", "oddkin_session"} {
		if strings.Contains(line, secret) {
			t.Fatalf("the log must not contain %q: %s", secret, line)
		}
	}
	for _, want := range []string{id, "POST /api/v1/projects/{projectId}", `"status":418`} {
		if !strings.Contains(line, want) {
			t.Fatalf("log is missing %q: %s", want, line)
		}
	}
}

func TestACallerSuppliedIDIsKeptOnlyWhenWellFormed(t *testing.T) {
	handler := withObservability(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}), nil)
	for header, kept := range map[string]bool{"trace-1234567890": true, "bad id\nwith newline": false, "x": false} {
		request := httptest.NewRequest(http.MethodGet, "/", nil)
		request.Header.Set(requestIDHeader, header)
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, request)
		if got := result.Header().Get(requestIDHeader); (got == header) != kept {
			t.Fatalf("header %q -> %q (kept=%v)", header, got, kept)
		}
	}
}

func TestHealthChecksAreNotLogged(t *testing.T) {
	var logs bytes.Buffer
	handler := withObservability(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}), slog.New(slog.NewJSONHandler(&logs, nil)))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/health/ready", nil))
	if logs.Len() != 0 {
		t.Fatalf("probes would drown the log: %s", logs.String())
	}
}
