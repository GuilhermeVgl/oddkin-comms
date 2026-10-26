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

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi"
	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestOrganizationBrandingRequiresAdminAndPersists(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var organizationID pgtype.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ('75000000-0000-4000-8000-000000000061', 'UTC') RETURNING id`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized LIKE 'brand-%@example.test'`)
	}()
	hash, err := identity.HashPassword("correct branding password")
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct {
		email string
		admin bool
	}{{"brand-admin@example.test", true}, {"brand-member@example.test", false}} {
		account, createErr := sqlc.New(pool).CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: row.email, PasswordHash: hash})
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, createErr := sqlc.New(pool).CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{OrganizationID: organizationID, AccountID: account.ID, MembershipKind: "internal", IsAdmin: row.admin}); createErr != nil {
			t.Fatal(createErr)
		}
	}
	handler, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	login := func(email string) *workClient {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"email":"`+email+`","password":"correct branding password"}`))
		req.Host = "crewstead.test"
		req.Header.Set("Origin", "http://crewstead.test")
		req.Header.Set("Content-Type", "application/json")
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		if result.Code != http.StatusNoContent {
			t.Fatalf("login %s: %d", email, result.Code)
		}
		client := &workClient{t: t, handler: handler}
		for _, cookie := range result.Result().Cookies() {
			switch cookie.Name {
			case "crewstead_session":
				client.session = cookie
			case "crewstead_csrf":
				client.csrf = cookie
			}
		}
		return client
	}
	admin := login("brand-admin@example.test")
	member := login("brand-member@example.test")
	path := "/api/v1/organization/branding"
	var before struct {
		Name    string
		ShowDuo bool
		HasLogo bool
	}
	if code := admin.do(http.MethodGet, path, "", &before); code != http.StatusOK || before.Name != "" || !before.ShowDuo {
		t.Fatalf("initial branding: code=%d data=%+v", code, before)
	}
	if code := member.do(http.MethodPatch, path, `{"name":"Equipe","showDuo":false}`, nil); code != http.StatusForbidden {
		t.Fatalf("member updated branding: %d", code)
	}
	if code := admin.do(http.MethodPatch, path, `{"name":"   ","showDuo":false}`, nil); code != http.StatusBadRequest {
		t.Fatalf("blank team name accepted: %d", code)
	}
	if code := admin.do(http.MethodPatch, path, `{"name":"Equipe Crew","showDuo":false}`, nil); code != http.StatusOK {
		t.Fatalf("admin update: %d", code)
	}
	var after struct {
		Name    string
		ShowDuo bool
		HasLogo bool
	}
	if code := member.do(http.MethodGet, path, "", &after); code != http.StatusOK || after.Name != "Equipe Crew" || after.ShowDuo {
		t.Fatalf("persisted branding: code=%d data=%+v", code, after)
	}
	if code := member.do(http.MethodGet, "/api/v1/organization/logo", "", nil); code != http.StatusNotFound {
		t.Fatalf("missing logo: %d", code)
	}
	png := "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/yQAAAABJRU5ErkJggg=="
	if code := admin.do(http.MethodPatch, path, `{"name":"Equipe Crew","showDuo":false,"logoMime":"image/png","logoBase64":"`+png+`"}`, nil); code != http.StatusOK {
		t.Fatalf("admin logo upload: %d", code)
	}
	if code := member.do(http.MethodGet, path, "", &after); code != http.StatusOK || !after.HasLogo {
		t.Fatalf("member cannot see logo setting: code=%d data=%+v", code, after)
	}
	logoRequest := httptest.NewRequest(http.MethodGet, "/api/v1/organization/logo", nil)
	logoRequest.AddCookie(member.session)
	logoResponse := httptest.NewRecorder()
	handler.ServeHTTP(logoResponse, logoRequest)
	if logoResponse.Code != http.StatusOK || logoResponse.Header().Get("Content-Type") != "image/png" || len(logoResponse.Body.Bytes()) == 0 {
		t.Fatalf("member logo download: code=%d mime=%q", logoResponse.Code, logoResponse.Header().Get("Content-Type"))
	}
	if code := admin.do(http.MethodPatch, path, `{"name":"Equipe Crew","showDuo":false,"removeLogo":true}`, nil); code != http.StatusOK {
		t.Fatalf("remove logo: %d", code)
	}
	if code := member.do(http.MethodGet, "/api/v1/organization/logo", "", nil); code != http.StatusNotFound {
		t.Fatalf("removed logo remains: %d", code)
	}
}
