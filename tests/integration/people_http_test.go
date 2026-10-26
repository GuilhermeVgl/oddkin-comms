//go:build integration

package integration

import (
	"net/http"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
)

// People can end their own sessions; only administrators deactivate accounts,
// which ends every session at once and never leaves the organization without one.
func TestSessionsAndAccountDeactivation(t *testing.T) {
	ctx, pool := openTestPool(t, 40*time.Second)
	organizationID := newTestOrganization(t, ctx, pool, "75000000-0000-4000-8000-000000000051", "UTC", "ppl-%@example.test")
	const password = "correct people password"
	ids := createTestMembers(t, ctx, sqlc.New(pool), organizationID, password, []string{"ppl-admin@example.test", "ppl-member@example.test"})
	handler, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	admin := loginClient(t, handler, "ppl-admin@example.test", password)
	first := loginClient(t, handler, "ppl-member@example.test", password)
	second := loginClient(t, handler, "ppl-member@example.test", password)

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
	if _, code := loginClientStatus(t, handler, "ppl-member@example.test", password); code != http.StatusUnauthorized {
		t.Fatalf("a deactivated account cannot sign in: %d", code)
	}
	if code := admin.do(http.MethodPut, "/api/v1/organization/people/"+ids["ppl-member@example.test"]+"/active", `{"active":true}`, nil); code != http.StatusNoContent {
		t.Fatalf("reactivate: %d", code)
	}
	if _, code := loginClientStatus(t, handler, "ppl-member@example.test", password); code != http.StatusNoContent {
		t.Fatalf("a reactivated account signs in again: %d", code)
	}
}
