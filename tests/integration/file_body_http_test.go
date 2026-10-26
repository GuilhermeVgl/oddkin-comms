//go:build integration

package integration

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi"
	"github.com/GuilhermeVgl/crewstead-comms/internal/keys"
	"github.com/GuilhermeVgl/crewstead-comms/internal/platform/objectstore"
)

// ADR 0019: file bodies are encrypted objects whose manifest the server checks
// like any encrypted write, and the key of the files domain never reaches
// people who cannot download files.
func TestEncryptedFileBodies(t *testing.T) {
	f := newE2EEFixture(t, "7c000000-0000-4000-8000-000000000001", "fb", []string{"admin", "ana", "external-ext"})
	memory := objectstore.NewMemory()
	handler, err := httpapi.NewAppHandlerWithConfig(f.pool, httpapi.AppConfig{ObjectStore: memory, StorageQuotaBytes: 100 << 20})
	if err != nil {
		t.Fatal(err)
	}
	f.handler = handler
	for _, client := range f.clients {
		client.handler = handler
	}
	admin, ana, external := f.clients["admin"], f.clients["ana"], f.clients["external-ext"]
	adminDevice, anaDevice, externalDevice := f.activate("admin", "Admin", "device"), f.activate("ana", "Ana", "device"), f.activate("external-ext", "Ext", "device")

	var project struct{ Id string }
	admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Arquivos cifrados"}`, &project)
	base := "/api/v1/projects/" + project.Id
	admin.do(http.MethodPost, base+"/members", `{"email":"fb-ana@example.test"}`, nil)
	admin.do(http.MethodPost, base+"/members", `{"email":"fb-external-ext@example.test"}`, nil)
	// The external reads work and chat but may not download files.
	if code := admin.do(http.MethodPut, base+"/external-policy", `{"version":1,"permissions":["work.read","chat.read"]}`, nil); code != http.StatusOK {
		t.Fatalf("policy: %d", code)
	}
	var task struct{ Id string }
	ana.do(http.MethodPost, base+"/work-items", `{"kind":"task","title":"Com anexo"}`, &task)

	var domain domainDTO
	if code := ana.do(http.MethodPost, base+"/key-domains", `{"kind":"files"}`, &domain); code != http.StatusCreated {
		t.Fatalf("files domain: %d", code)
	}
	var visible []struct{ Kind string }
	external.do(http.MethodGet, base+"/key-domains", "", &visible)
	for _, entry := range visible {
		if entry.Kind == "files" {
			t.Fatal("someone who cannot download files must not even see the files domain")
		}
	}
	// The key may go only to people who can download: sending it to the external is refused.
	if code := f.publish(ana, domain.Id, anaDevice, 1, []testDevice{adminDevice, anaDevice, f.recovery, externalDevice}); code == http.StatusOK {
		t.Fatal("the files key must not be published to a device without files.download")
	}
	if code := f.publish(ana, domain.Id, anaDevice, 1, []testDevice{adminDevice, anaDevice, f.recovery}); code != http.StatusOK {
		t.Fatalf("files generation: %d", code)
	}

	encryptedSize := func(n int64) int64 { return 187 + n + 17*((n+262143)/262144) }
	signer := fmt.Sprintf(`,"signerDeviceId":%q`, anaDevice.id)
	request := func(id string, size int64, signer string, extra string) string {
		return fmt.Sprintf(`{"id":%q,"contextType":"work_item","contextId":%q,"name":"cópia.bin","size":%d%s%s}`, id, task.Id, size, signer, extra)
	}
	newID := func() string {
		raw := make([]byte, 16)
		_, _ = rand.Read(raw)
		raw[6], raw[8] = raw[6]&0x0f|0x40, raw[8]&0x3f|0x80
		return fmt.Sprintf("%x-%x-%x-%x-%x", raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:])
	}
	post := func(client *workClient, path, body string) (int, string) {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
		req.Host = "crewstead.test"
		req.Header.Set("Origin", "http://crewstead.test")
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(client.session)
		req.Header.Set("X-CSRF-Token", client.csrf.Value)
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		return result.Code, result.Body.String()
	}
	const original = 3_000_000
	size := encryptedSize(original)

	if code, body := post(ana, "/api/v1/uploads", request(newID(), original, signer, "")); code != http.StatusConflict || !strings.Contains(body, "encryption_required") {
		t.Fatalf("a plaintext body is refused once the domain has a generation: %d %s", code, body)
	}

	// Limits and size arithmetic.
	encrypted := `,"bodyEncrypted":true`
	if code, _ := post(ana, "/api/v1/uploads", request(newID(), encryptedSize(500_000_001), signer, encrypted)); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("500000001 bytes of original file: %d", code)
	}
	if code, _ := post(ana, "/api/v1/uploads", request(newID(), encryptedSize(500_000_000), signer, encrypted)); code != http.StatusInsufficientStorage {
		t.Fatalf("exactly 500 MB passes the size check and meets the test quota: %d", code)
	}
	if code, _ := post(ana, "/api/v1/uploads", request(newID(), encryptedSize(262144)+1, signer, encrypted)); code != http.StatusBadRequest {
		t.Fatalf("a size no file produces: %d", code)
	}
	if code, _ := post(ana, "/api/v1/uploads", request(newID(), size, "", encrypted)); code != http.StatusBadRequest {
		t.Fatalf("an encrypted body needs the signing device: %d", code)
	}
	if code, _ := post(ana, "/api/v1/uploads", request(newID(), size, fmt.Sprintf(`,"signerDeviceId":%q`, adminDevice.id), encrypted)); code != http.StatusForbidden {
		t.Fatalf("someone else's device: %d", code)
	}
	if code, _ := post(external, "/api/v1/uploads", request(newID(), size, fmt.Sprintf(`,"signerDeviceId":%q`, externalDevice.id), encrypted)); code != http.StatusForbidden {
		t.Fatalf("an external without files.download cannot upload: %d", code)
	}

	// An object is built like the client does: magic, version, a signed manifest of the
	// fixed size, then opaque records up to the exact encrypted size.
	object := func(resource string, generation uint32, device testDevice, magic string) []byte {
		header := make([]byte, 30)
		header[0], header[1] = 1, 1
		binary.BigEndian.PutUint32(header[2:6], generation)
		_, _ = rand.Read(header[6:])
		ciphertext := make([]byte, 72+16)
		_, _ = rand.Read(ciphertext)
		signature := ed25519.Sign(device.signSecret, keys.ContentSignedBytes(keys.ContentMetadata{
			OrganizationID: f.orgID, DomainID: domain.Id, ResourceID: resource, AuthorID: f.accounts["ana"], Revision: 1,
		}, header, ciphertext))
		data := append([]byte(magic), 1)
		data = append(append(append(data, header...), ciphertext...), signature...)
		rest := make([]byte, int(size)-len(data))
		_, _ = rand.Read(rest)
		return append(data, rest...)
	}
	attempt := func(label string, build func(id string) []byte, wantCode int, wantBody string) string {
		t.Helper()
		id := newID()
		data := build(id)
		if code, body := post(ana, "/api/v1/uploads", request(id, int64(len(data)), signer, encrypted)); code != http.StatusCreated {
			t.Fatalf("%s: create %d %s", label, code, body)
		}
		var remote string
		if err := f.pool.QueryRow(f.ctx, `SELECT upload_id FROM attachment WHERE id::text = $1`, id).Scan(&remote); err != nil {
			t.Fatal(err)
		}
		memory.PutPartData(remote, 1, data)
		code, body := post(ana, "/api/v1/uploads/"+id+"/complete", `{"parts":[{"partNumber":1,"etag":"a"}]}`)
		if code != wantCode || !strings.Contains(body, wantBody) {
			t.Fatalf("%s: %d %s", label, code, body)
		}
		var state string
		_ = f.pool.QueryRow(f.ctx, `SELECT state FROM attachment WHERE id::text = $1`, id).Scan(&state)
		if wantCode != http.StatusOK && state != "aborted" {
			t.Fatalf("%s: an invalid object must be discarded, state=%s", label, state)
		}
		return id
	}
	manifest := func(id string) string { return "at:" + id + ":manifest" }
	attempt("not an CSKF object", func(id string) []byte { return object(manifest(id), 1, anaDevice, "NOPE") }, http.StatusBadRequest, "bad_envelope")
	attempt("signed by another device", func(id string) []byte { return object(manifest(id), 1, adminDevice, "CSKF") }, http.StatusBadRequest, "bad_envelope")
	attempt("stale key generation", func(id string) []byte { return object(manifest(id), 2, anaDevice, "CSKF") }, http.StatusConflict, "stale_generation")
	attempt("manifest of another attachment", func(string) []byte {
		return object(manifest("00000000-0000-4000-8000-00000000ffff"), 1, anaDevice, "CSKF")
	}, http.StatusBadRequest, "bad_envelope")

	id := attempt("valid object", func(id string) []byte { return object(manifest(id), 1, anaDevice, "CSKF") }, http.StatusOK, `"bodyEncrypted":true`)
	var listed []struct {
		Id            string
		BodyEncrypted bool
		Size          int64
		ContentSize   int64
	}
	if code := ana.do(http.MethodGet, "/api/v1/work-items/"+task.Id+"/attachments", "", &listed); code != http.StatusOK || len(listed) != 1 ||
		listed[0].Id != id || !listed[0].BodyEncrypted || listed[0].Size != size || listed[0].ContentSize != original {
		t.Fatalf("listing: %d %+v", code, listed)
	}
	if code := external.do(http.MethodGet, "/api/v1/attachments/"+id+"/download", "", nil); code != http.StatusForbidden {
		t.Fatalf("an external without files.download gets neither the URL nor the key: %d", code)
	}
	if code := ana.do(http.MethodGet, "/api/v1/attachments/"+id+"/download", "", nil); code != http.StatusOK {
		t.Fatalf("download: %d", code)
	}

	// The domain rotates after the external is removed from nothing but a member removal
	// elsewhere would: here we only check that a stale writer is refused after rotation.
	if code := admin.do(http.MethodDelete, base+"/members/"+f.accounts["ana"], "", nil); code != http.StatusNoContent {
		t.Fatalf("remove member: %d", code)
	}
	var state domainDTO
	admin.do(http.MethodGet, "/api/v1/key-domains/"+domain.Id+"/recipients", "", nil)
	_ = state
	if code, body := post(admin, "/api/v1/uploads", request(newID(), size, fmt.Sprintf(`,"signerDeviceId":%q`, adminDevice.id), encrypted)); code != http.StatusConflict || !strings.Contains(body, "rotation_required") {
		t.Fatalf("uploads wait for the new generation after a revocation: %d %s", code, body)
	}
}
