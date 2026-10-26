//go:build integration

package integration

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

// A profile photo is seen by its owner, by people who share a project with them
// and by administrators; never by anyone else, and only as a small raster image.
func TestProfilePhotos(t *testing.T) {
	f := newE2EEFixture(t, "80000000-0000-4000-8000-000000000001", "av", []string{"admin", "ana", "bia", "carlos"})
	admin, ana, bia, carlos := f.clients["admin"], f.clients["ana"], f.clients["bia"], f.clients["carlos"]
	var project struct{ Id string }
	admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Fotos"}`, &project)
	base := "/api/v1/projects/" + project.Id
	admin.do(http.MethodPost, base+"/members", `{"email":"av-ana@example.test"}`, nil)
	admin.do(http.MethodPost, base+"/members", `{"email":"av-bia@example.test"}`, nil)

	png := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'}, bytes.Repeat([]byte{7}, 200)...)
	put := func(client *workClient, contentType string, body []byte) int {
		req := httptest.NewRequest(http.MethodPut, "/api/v1/account/avatar", bytes.NewReader(body))
		req.Host = "oddkin.test"
		req.Header.Set("Origin", "http://oddkin.test")
		req.Header.Set("Content-Type", contentType)
		req.AddCookie(client.session)
		req.Header.Set("X-CSRF-Token", client.csrf.Value)
		result := httptest.NewRecorder()
		f.handler.ServeHTTP(result, req)
		return result.Code
	}
	get := func(client *workClient, id string) (int, string, []byte) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/accounts/"+id+"/avatar", nil)
		req.Host = "oddkin.test"
		req.AddCookie(client.session)
		result := httptest.NewRecorder()
		f.handler.ServeHTTP(result, req)
		return result.Code, result.Header().Get("Content-Type"), result.Body.Bytes()
	}

	if code := put(ana, "image/svg+xml", []byte("<svg onload=alert(1)/>")); code == http.StatusNoContent {
		t.Fatal("SVG can carry script and must be refused")
	}
	if code := put(ana, "image/png", []byte("not an image at all")); code != http.StatusBadRequest {
		t.Fatalf("a body that is not the declared image: %d", code)
	}
	if code := put(ana, "image/jpeg", png); code != http.StatusBadRequest {
		t.Fatalf("a PNG declared as JPEG: %d", code)
	}
	if code := put(ana, "image/png", append(png, bytes.Repeat([]byte{1}, 300<<10)...)); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("an oversized photo: %d", code)
	}
	if code := put(ana, "image/png", png); code != http.StatusNoContent {
		t.Fatalf("upload: %d", code)
	}

	// Owner, project mates and the administrator see it; others do not, and cannot tell it exists.
	for who, client := range map[string]*workClient{"owner": ana, "mate": bia, "admin": admin} {
		code, kind, body := get(client, f.accounts["ana"])
		if code != http.StatusOK || kind != "image/png" || !bytes.Equal(body, png) {
			t.Fatalf("%s: %d %s", who, code, kind)
		}
	}
	if code, _, _ := get(carlos, f.accounts["ana"]); code != http.StatusNotFound {
		t.Fatalf("someone with nothing in common: %d", code)
	}
	if code, _, _ := get(bia, f.accounts["bia"]); code != http.StatusNotFound {
		t.Fatalf("no photo yet: %d", code)
	}
	var listed []struct {
		AccountId string
		Version   int
	}
	if bia.do(http.MethodGet, "/api/v1/avatars", "", &listed); len(listed) != 1 || listed[0].AccountId != f.accounts["ana"] || listed[0].Version != 1 {
		t.Fatalf("the list for a project mate: %+v", listed)
	}
	listed = nil
	if carlos.do(http.MethodGet, "/api/v1/avatars", "", &listed); len(listed) != 0 {
		t.Fatalf("the list for a stranger: %+v", listed)
	}
	// A new photo bumps the version; removing it hides the photo.
	put(ana, "image/png", append(png, 9))
	bia.do(http.MethodGet, "/api/v1/avatars", "", &listed)
	if len(listed) != 1 || listed[0].Version != 2 {
		t.Fatalf("version after a change: %+v", listed)
	}
	if code := ana.do(http.MethodDelete, "/api/v1/account/avatar", "", nil); code != http.StatusNoContent {
		t.Fatalf("remove: %d", code)
	}
	if code, _, _ := get(bia, f.accounts["ana"]); code != http.StatusNotFound {
		t.Fatalf("after removing: %d", code)
	}
}
