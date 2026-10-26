package httpapi

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return &logs
}

func TestServerErrorLogsTheCauseButNeverSendsItToTheClient(t *testing.T) {
	logs := captureLogs(t)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/things", nil)
	request.Pattern = "POST /api/v1/things"
	recorder := httptest.NewRecorder()
	recorder.Header().Set(requestIDHeader, "req-123456789")

	serverError(recorder, request, errors.New("connection refused to media.internal:7880"))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: %d", recorder.Code)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("the client must not receive the cause: %q", recorder.Body.String())
	}
	line := logs.String()
	for _, want := range []string{"POST /api/v1/things", "req-123456789", "connection refused"} {
		if !strings.Contains(line, want) {
			t.Fatalf("log line misses %q: %s", want, line)
		}
	}
}

func TestServerErrorDescribesDatabaseErrorsWithoutTheirDetail(t *testing.T) {
	logs := captureLogs(t)
	request := httptest.NewRequest(http.MethodPut, "/x", nil)
	cause := &pgconn.PgError{Code: "23505", ConstraintName: "account_email_key", Message: "duplicate key", Detail: "Key (email)=(ana@example.test) already exists."}

	serverError(httptest.NewRecorder(), request, cause)

	line := logs.String()
	if !strings.Contains(line, "23505") || !strings.Contains(line, "account_email_key") {
		t.Fatalf("log must carry the SQLSTATE and constraint: %s", line)
	}
	if strings.Contains(line, "ana@example.test") {
		t.Fatalf("row values must never reach the log: %s", line)
	}
}

func TestRespondErrorMapsOutcomes(t *testing.T) {
	logs := captureLogs(t)
	cases := []struct {
		name    string
		err     error
		wrote   bool
		status  int
		logged  bool
		comment string
	}{
		{"success writes nothing", nil, false, http.StatusOK, false, ""},
		{"a status error answers with that status", statusError(http.StatusConflict), true, http.StatusConflict, false, ""},
		{"an already written response is left alone", errResponded, true, http.StatusOK, false, ""},
		{"anything else is a 503 and is logged", context.DeadlineExceeded, true, http.StatusServiceUnavailable, true, ""},
	}
	for _, c := range cases {
		logs.Reset()
		recorder := httptest.NewRecorder()
		wrote := respondError(recorder, httptest.NewRequest(http.MethodGet, "/x", nil), c.err)
		if wrote != c.wrote {
			t.Errorf("%s: wrote=%v", c.name, wrote)
		}
		if c.wrote && c.err != errResponded && recorder.Code != c.status {
			t.Errorf("%s: status %d, want %d", c.name, recorder.Code, c.status)
		}
		if (logs.Len() > 0) != c.logged {
			t.Errorf("%s: logged=%v", c.name, logs.Len() > 0)
		}
	}
}

func TestRespondErrorSeesThroughWrapping(t *testing.T) {
	recorder := httptest.NewRecorder()
	wrapped := errors.Join(errors.New("context"), statusError(http.StatusNotFound))
	if !respondError(recorder, httptest.NewRequest(http.MethodGet, "/x", nil), wrapped) || recorder.Code != http.StatusNotFound {
		t.Fatalf("a wrapped status error must still answer %d, got %d", http.StatusNotFound, recorder.Code)
	}
}
