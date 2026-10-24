package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type probeFunc func(context.Context) error

func (f probeFunc) Ping(ctx context.Context) error { return f(ctx) }

func TestLivenessDoesNotDependOnDatabase(t *testing.T) {
	t.Parallel()
	called := false
	handler := NewHandler(probeFunc(func(context.Context) error {
		called = true
		return errors.New("database unavailable")
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/health/live", nil))
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 || called {
		t.Fatalf("liveness: status=%d body=%q database called=%t", response.Code, response.Body.String(), called)
	}
}

func TestReadinessTracksDatabaseWithoutLeakingErrors(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name string
		err  error
		want int
	}{
		{"available", nil, http.StatusNoContent},
		{"unavailable", errors.New("secret database detail"), http.StatusServiceUnavailable},
	} {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			handler := NewHandler(probeFunc(func(context.Context) error {
				called = true
				return tt.err
			}))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/health/ready", nil))
			if response.Code != tt.want || !called {
				t.Fatalf("readiness: status=%d called=%t; want %d and call", response.Code, called, tt.want)
			}
			if strings.Contains(response.Body.String(), "secret database detail") {
				t.Fatal("readiness exposed internal database error")
			}
		})
	}
}

func TestReadinessUsesRequestContext(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/health/ready", nil).WithContext(ctx)
	called := false
	handler := NewHandler(probeFunc(func(got context.Context) error {
		called = true
		if got.Err() != context.Canceled {
			t.Fatal("database probe did not inherit request cancellation")
		}
		return got.Err()
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !called {
		t.Fatalf("canceled readiness: status=%d called=%t", response.Code, called)
	}
}

func TestReadinessBoundsDatabaseProbe(t *testing.T) {
	t.Parallel()
	deadlineSeen := false
	handler := NewHandler(probeFunc(func(ctx context.Context) error {
		_, deadlineSeen = ctx.Deadline()
		return nil
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/health/ready", nil))
	if !deadlineSeen {
		t.Fatal("database probe has no deadline")
	}
}

func TestHealthOnlyHandlerDoesNotServeInvitationFlows(t *testing.T) {
	t.Parallel()
	handler := NewHandler(probeFunc(func(context.Context) error { return nil }))
	for _, path := range []string{"/api/v1/invitations", "/api/v1/invitations/accept"} {
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"email":"person@example.test","membershipKind":"external","token":"0000000000000000000000000000000000000000000"}`))
		request.Host = "oddkin.test"
		request.Header.Set("Origin", "http://oddkin.test")
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s status=%d", path, response.Code)
		}
	}
}
