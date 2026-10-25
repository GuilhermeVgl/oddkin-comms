//go:build integration

package integration

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi"
	"github.com/GuilhermeVgl/oddkin-comms/internal/identity"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// People can end their own sessions; only administrators deactivate accounts,
// which ends every session at once and never leaves the organization without one.
func TestSessionsAndAccountDeactivation(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var organizationID pgtype.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ('75000000-0000-4000-8000-000000000051', 'UTC') RETURNING id`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized LIKE 'ppl-%@example.test'`)
	}()
	hash, err := identity.HashPassword("correct people password")
	if err != nil {
		t.Fatal(err)
	}
	queries := sqlc.New(pool)
	ids := map[string]string{}
	for _, email := range []string{"ppl-admin@example.test", "ppl-member@example.test"} {
		account, createErr := queries.CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: email, PasswordHash: hash})
		if createErr != nil {
			t.Fatal(createErr)
		}
		ids[email] = uuid.UUID(account.ID.Bytes).String()
		if _, createErr = queries.CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{
			OrganizationID: organizationID, AccountID: account.ID, MembershipKind: "internal", IsAdmin: email == "ppl-admin@example.test",
		}); createErr != nil {
			t.Fatal(createErr)
		}
	}
	handler, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	login := func(email string) (*workClient, int) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"email":"`+email+`","password":"correct people password"}`))
		req.Host = "oddkin.test"
		req.Header.Set("Origin", "http://oddkin.test")
		req.Header.Set("Content-Type", "application/json")
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		client := &workClient{t: t, handler: handler}
		for _, cookie := range result.Result().Cookies() {
			switch cookie.Name {
			case "oddkin_session":
				client.session = cookie
			case "oddkin_csrf":
				client.csrf = cookie
			}
		}
		return client, result.Code
	}
	admin, _ := login("ppl-admin@example.test")
	first, _ := login("ppl-member@example.test")
	second, _ := login("ppl-member@example.test")

	type authSession struct {
		Id      string
		Current bool
	}
	var sessions []authSession
	if code := first.do(http.MethodGet, "/api/v1/sessions", "", &sessions); code != http.StatusOK || len(sessions) != 2 {
		t.Fatalf("sessions: %d %+v", code, sessions)
	}
	var other string
	for _, entry := range sessions {
		if !entry.Current {
			other = entry.Id
		}
	}
	var adminSessions []authSession
	admin.do(http.MethodGet, "/api/v1/sessions", "", &adminSessions)
	if code := first.do(http.MethodDelete, "/api/v1/sessions/"+adminSessions[0].Id, "", nil); code != http.StatusNotFound {
		t.Fatalf("someone else's session: %d", code)
	}
	if code := first.do(http.MethodDelete, "/api/v1/sessions/"+other, "", nil); code != http.StatusNoContent {
		t.Fatalf("revoke other session: %d", code)
	}
	if code := second.do(http.MethodGet, "/api/v1/auth/me", "", nil); code != http.StatusUnauthorized {
		t.Fatalf("a revoked session must stop working (or this was the current one): %d", code)
	}
	if code := first.do(http.MethodGet, "/api/v1/auth/me", "", nil); code != http.StatusOK {
		t.Fatalf("the other session stays: %d", code)
	}

	if code := first.do(http.MethodGet, "/api/v1/organization/people", "", nil); code != http.StatusForbidden {
		t.Fatalf("people as member: %d", code)
	}
	var people []struct {
		Id     string
		Email  string
		Active bool
	}
	if code := admin.do(http.MethodGet, "/api/v1/organization/people", "", &people); code != http.StatusOK || len(people) != 2 {
		t.Fatalf("people: %d %+v", code, people)
	}
	if code := first.do(http.MethodPut, "/api/v1/organization/people/"+ids["ppl-admin@example.test"]+"/active", `{"active":false}`, nil); code != http.StatusForbidden {
		t.Fatalf("deactivate as member: %d", code)
	}
	if code := admin.do(http.MethodPut, "/api/v1/organization/people/"+ids["ppl-admin@example.test"]+"/active", `{"active":false}`, nil); code != http.StatusConflict {
		t.Fatalf("the last administrator cannot be deactivated: %d", code)
	}
	if code := admin.do(http.MethodPut, "/api/v1/organization/people/"+ids["ppl-member@example.test"]+"/active", `{"active":false}`, nil); code != http.StatusNoContent {
		t.Fatalf("deactivate: %d", code)
	}
	if code := first.do(http.MethodGet, "/api/v1/auth/me", "", nil); code != http.StatusUnauthorized {
		t.Fatalf("deactivation ends every session: %d", code)
	}
	if _, code := login("ppl-member@example.test"); code != http.StatusUnauthorized {
		t.Fatalf("a deactivated account cannot sign in: %d", code)
	}
	if code := admin.do(http.MethodPut, "/api/v1/organization/people/"+ids["ppl-member@example.test"]+"/active", `{"active":true}`, nil); code != http.StatusNoContent {
		t.Fatalf("reactivate: %d", code)
	}
	if _, code := login("ppl-member@example.test"); code != http.StatusNoContent {
		t.Fatalf("a reactivated account signs in again: %d", code)
	}
}
