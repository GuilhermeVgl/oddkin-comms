//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi"
	"github.com/GuilhermeVgl/oddkin-comms/internal/identity"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestHTTPLoginSessionAndLogout(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	hash, err := identity.HashPassword("correct long password")
	if err != nil {
		t.Fatal(err)
	}
	account, err := sqlc.New(pool).CreateAccount(ctx, sqlc.CreateAccountParams{
		EmailNormalized: "login@example.test", PasswordHash: hash,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM account WHERE id = $1`, account.ID); err != nil {
			t.Error(err)
		}
	}()
	handler, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path, body string) *http.Request {
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body)).WithContext(ctx)
		r.Host = "oddkin.test"
		r.Header.Set("Origin", "http://oddkin.test")
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		return r
	}
	crossOrigin := request(http.MethodPost, "/api/v1/auth/login", `{"email":"login@example.test","password":"correct long password"}`)
	crossOrigin.Header.Set("Origin", "http://other.test")
	blockedOrigin := httptest.NewRecorder()
	handler.ServeHTTP(blockedOrigin, crossOrigin)
	if blockedOrigin.Code != http.StatusForbidden || len(blockedOrigin.Result().Cookies()) != 0 {
		t.Fatalf("cross-origin login was accepted: status=%d", blockedOrigin.Code)
	}
	bad := httptest.NewRecorder()
	handler.ServeHTTP(bad, request(http.MethodPost, "/api/v1/auth/login", `{"email":"login@example.test","password":"incorrect long password"}`))
	if bad.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password: status=%d", bad.Code)
	}
	unknown := httptest.NewRecorder()
	handler.ServeHTTP(unknown, request(http.MethodPost, "/api/v1/auth/login", `{"email":"unknown@example.test","password":"incorrect long password"}`))
	if unknown.Code != http.StatusUnauthorized || unknown.Body.String() != bad.Body.String() {
		t.Fatalf("unknown account must get same response: status=%d body=%q", unknown.Code, unknown.Body.String())
	}
	login := httptest.NewRecorder()
	handler.ServeHTTP(login, request(http.MethodPost, "/api/v1/auth/login", `{"email":"LOGIN@EXAMPLE.TEST","password":"correct long password"}`))
	if login.Code != http.StatusNoContent {
		t.Fatalf("valid login: status=%d body=%q", login.Code, login.Body.String())
	}
	var sessionCookie, csrfCookie *http.Cookie
	for _, cookie := range login.Result().Cookies() {
		switch cookie.Name {
		case "oddkin_session":
			sessionCookie = cookie
		case "oddkin_csrf":
			csrfCookie = cookie
		}
	}
	if sessionCookie == nil || csrfCookie == nil || !sessionCookie.HttpOnly || !sessionCookie.Secure || !csrfCookie.Secure || csrfCookie.HttpOnly || sessionCookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("session cookie flags invalid: session=%+v csrf=%+v", sessionCookie, csrfCookie)
	}
	meRequest := request(http.MethodGet, "/api/v1/auth/me", "")
	meRequest.AddCookie(sessionCookie)
	me := httptest.NewRecorder()
	handler.ServeHTTP(me, meRequest)
	if me.Code != http.StatusOK {
		t.Fatalf("current account: status=%d body=%q", me.Code, me.Body.String())
	}
	var current struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(me.Body.Bytes(), &current); err != nil || current.Email != "login@example.test" {
		t.Fatalf("current account response: %+v err=%v", current, err)
	}
	logoutRequest := request(http.MethodPost, "/api/v1/auth/logout", "")
	logoutRequest.AddCookie(sessionCookie)
	withoutCSRF := httptest.NewRecorder()
	handler.ServeHTTP(withoutCSRF, logoutRequest)
	if withoutCSRF.Code != http.StatusForbidden {
		t.Fatalf("logout without CSRF: status=%d", withoutCSRF.Code)
	}
	logoutRequest.Header.Set("X-CSRF-Token", csrfCookie.Value)
	logout := httptest.NewRecorder()
	handler.ServeHTTP(logout, logoutRequest)
	if logout.Code != http.StatusNoContent {
		t.Fatalf("logout: status=%d", logout.Code)
	}
	meAfter := httptest.NewRecorder()
	handler.ServeHTTP(meAfter, meRequest)
	if meAfter.Code != http.StatusUnauthorized {
		t.Fatalf("revoked session still authenticates: status=%d", meAfter.Code)
	}
	var otherSessions []*http.Cookie
	for range 2 {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodPost, "/api/v1/auth/login", `{"email":"login@example.test","password":"correct long password"}`))
		if response.Code != http.StatusNoContent {
			t.Fatalf("second device login: status=%d", response.Code)
		}
		for _, cookie := range response.Result().Cookies() {
			otherSessions = append(otherSessions, cookie)
		}
	}
	logoutAll := request(http.MethodPost, "/api/v1/auth/logout-all", "")
	for _, cookie := range otherSessions[:2] {
		logoutAll.AddCookie(cookie)
	}
	for _, cookie := range otherSessions[:2] {
		if cookie.Name == "oddkin_csrf" {
			logoutAll.Header.Set("X-CSRF-Token", cookie.Value)
		}
	}
	allResult := httptest.NewRecorder()
	handler.ServeHTTP(allResult, logoutAll)
	if allResult.Code != http.StatusNoContent {
		t.Fatalf("global logout: status=%d", allResult.Code)
	}
	otherMe := request(http.MethodGet, "/api/v1/auth/me", "")
	for _, cookie := range otherSessions[2:] {
		if cookie.Name == "oddkin_session" {
			otherMe.AddCookie(cookie)
		}
	}
	otherResult := httptest.NewRecorder()
	handler.ServeHTTP(otherResult, otherMe)
	if otherResult.Code != http.StatusUnauthorized {
		t.Fatalf("other device remained logged in: status=%d", otherResult.Code)
	}
	for range 5 {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request(http.MethodPost, "/api/v1/auth/login", `{"email":"bruteforce@example.test","password":"incorrect long password"}`))
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("unexpected rate limit before threshold: status=%d", response.Code)
		}
	}
	limited := httptest.NewRecorder()
	handler.ServeHTTP(limited, request(http.MethodPost, "/api/v1/auth/login", `{"email":"bruteforce@example.test","password":"incorrect long password"}`))
	if limited.Code != http.StatusTooManyRequests {
		t.Fatalf("repeated failures not limited: status=%d", limited.Code)
	}
}
