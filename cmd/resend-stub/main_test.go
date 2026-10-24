package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInboxReceivesResendRequestAndRendersMessage(t *testing.T) {
	handler := newInboxHandler()
	body := `{"from":"notices@example.test","to":["person@example.test"],"subject":"Convite ODDKIN","text":"Abra #accept-invitation?token=synthetic"}`
	request := httptest.NewRequest(http.MethodPost, "/emails", bytes.NewBufferString(body))
	request.Header.Set("Authorization", "Bearer synthetic-local-key")
	request.Header.Set("Idempotency-Key", "invitation/1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"id":"local-`) {
		t.Fatalf("receive response: status=%d body=%q", response.Code, response.Body.String())
	}

	page := httptest.NewRecorder()
	handler.ServeHTTP(page, httptest.NewRequest(http.MethodGet, "/", nil))
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "person@example.test") ||
		!strings.Contains(page.Body.String(), "#accept-invitation?token=synthetic") {
		t.Fatalf("inbox page: status=%d body=%q", page.Code, page.Body.String())
	}
}

func TestInboxRejectsUnauthenticatedOrInvalidRequests(t *testing.T) {
	handler := newInboxHandler()
	unauthenticated := httptest.NewRecorder()
	handler.ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodPost, "/emails", strings.NewReader(`{}`)))
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status=%d", unauthenticated.Code)
	}

	invalidRequest := httptest.NewRequest(http.MethodPost, "/emails", strings.NewReader(`{}`))
	invalidRequest.Header.Set("Authorization", "Bearer synthetic")
	invalidRequest.Header.Set("Idempotency-Key", "invitation/1")
	invalid := httptest.NewRecorder()
	handler.ServeHTTP(invalid, invalidRequest)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid status=%d", invalid.Code)
	}
}
