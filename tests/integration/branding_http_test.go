//go:build integration

package integration

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
)

func TestOrganizationBrandingRequiresAdminAndPersists(t *testing.T) {
	ctx, pool := openTestPool(t, 30*time.Second)
	organizationID := newTestOrganization(t, ctx, pool, "75000000-0000-4000-8000-000000000061", "UTC", "brand-%@example.test")
	createTestMembers(t, ctx, sqlc.New(pool), organizationID, "correct branding password", []string{"brand-admin@example.test", "brand-member@example.test"})
	handler, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	admin := loginClient(t, handler, "brand-admin@example.test", "correct branding password")
	member := loginClient(t, handler, "brand-member@example.test", "correct branding password")
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
