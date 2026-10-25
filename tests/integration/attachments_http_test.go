//go:build integration

package integration

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi"
	"github.com/GuilhermeVgl/oddkin-comms/internal/identity"
	"github.com/GuilhermeVgl/oddkin-comms/internal/jobs"
	"github.com/GuilhermeVgl/oddkin-comms/internal/platform/objectstore"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAttachmentsUploadDownloadAndCleanup(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var organizationID pgtype.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ('77000000-0000-4000-8000-000000000001', 'UTC') RETURNING id`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized LIKE 'att-%@example.test'`)
	}()
	hash, err := identity.HashPassword("correct attachment password")
	if err != nil {
		t.Fatal(err)
	}
	queries := sqlc.New(pool)
	for _, email := range []string{"att-admin@example.test", "att-member@example.test", "att-external@example.test", "att-outsider@example.test"} {
		account, createErr := queries.CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: email, PasswordHash: hash})
		if createErr != nil {
			t.Fatal(createErr)
		}
		kind := "internal"
		if strings.Contains(email, "external") {
			kind = "external"
		}
		if _, createErr = queries.CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{
			OrganizationID: organizationID, AccountID: account.ID, MembershipKind: kind, IsAdmin: strings.Contains(email, "admin"),
		}); createErr != nil {
			t.Fatal(createErr)
		}
	}
	memory := objectstore.NewMemory()
	handler, err := httpapi.NewAppHandlerWithConfig(pool, httpapi.AppConfig{ObjectStore: memory, StorageQuotaBytes: 100 << 20})
	if err != nil {
		t.Fatal(err)
	}
	unconfigured, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	login := func(h http.Handler, email string) *workClient {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"email":"`+email+`","password":"correct attachment password"}`))
		req.Host = "oddkin.test"
		req.Header.Set("Origin", "http://oddkin.test")
		req.Header.Set("Content-Type", "application/json")
		result := httptest.NewRecorder()
		h.ServeHTTP(result, req)
		if result.Code != http.StatusNoContent {
			t.Fatalf("login %s: %d", email, result.Code)
		}
		c := &workClient{t: t, handler: h}
		for _, cookie := range result.Result().Cookies() {
			if cookie.Name == "oddkin_session" {
				c.session = cookie
			}
			if cookie.Name == "oddkin_csrf" {
				c.csrf = cookie
			}
		}
		return c
	}
	admin, member := login(handler, "att-admin@example.test"), login(handler, "att-member@example.test")
	external, outsider := login(handler, "att-external@example.test"), login(handler, "att-outsider@example.test")

	var project struct{ Id string }
	if code := admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Arquivos"}`, &project); code != http.StatusCreated {
		t.Fatalf("project: %d", code)
	}
	base := "/api/v1/projects/" + project.Id
	for _, email := range []string{"att-member@example.test", "att-external@example.test"} {
		if code := admin.do(http.MethodPost, base+"/members", `{"email":"`+email+`"}`, nil); code != http.StatusNoContent {
			t.Fatalf("add member: %d", code)
		}
	}
	var task struct{ Id string }
	if code := member.do(http.MethodPost, base+"/work-items", `{"kind":"task","title":"Com anexo"}`, &task); code != http.StatusCreated {
		t.Fatalf("task: %d", code)
	}
	body := func(size int64) string {
		return fmt.Sprintf(`{"contextType":"work_item","contextId":%q,"name":"relatório.pdf","contentType":"application/pdf","size":%d}`, task.Id, size)
	}
	type uploadDTO struct {
		Id        string
		PartSize  int
		PartCount int
	}

	// Storage must be configured.
	if code := login(unconfigured, "att-member@example.test").do(http.MethodPost, "/api/v1/uploads", body(10), nil); code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured storage: %d", code)
	}
	// Access and limits.
	if code := outsider.do(http.MethodPost, "/api/v1/uploads", body(10), nil); code != http.StatusNotFound {
		t.Fatalf("outsider upload: %d", code)
	}
	if code := member.do(http.MethodPost, "/api/v1/uploads", body(500_000_001), nil); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("500000001 bytes must be rejected: %d", code)
	}
	if code := member.do(http.MethodPost, "/api/v1/uploads", body(500_000_000), nil); code != http.StatusInsufficientStorage {
		t.Fatalf("exactly 500 MB is valid but exceeds the 100 MiB test quota: %d", code)
	}
	if code := member.do(http.MethodPost, "/api/v1/uploads", body(0), nil); code != http.StatusBadRequest {
		t.Fatalf("empty file: %d", code)
	}

	// Full multipart flow with three parts (20 MiB at 8 MiB per part).
	const size = 20 << 20
	var upload uploadDTO
	if code := member.do(http.MethodPost, "/api/v1/uploads", body(size), &upload); code != http.StatusCreated || upload.PartCount != 3 || upload.PartSize != 8<<20 {
		t.Fatalf("create upload: %d %+v", code, upload)
	}
	if code := member.do(http.MethodPost, "/api/v1/uploads", body(10), nil); code != http.StatusConflict {
		t.Fatalf("second concurrent upload: %d", code)
	}
	var presigned struct {
		Url              string
		ExpiresInSeconds int
	}
	if code := member.do(http.MethodGet, "/api/v1/uploads/"+upload.Id+"/parts/4", "", nil); code != http.StatusBadRequest {
		t.Fatalf("part outside the session: %d", code)
	}
	if code := outsider.do(http.MethodGet, "/api/v1/uploads/"+upload.Id+"/parts/1", "", nil); code != http.StatusNotFound {
		t.Fatalf("someone else's upload: %d", code)
	}
	if code := member.do(http.MethodGet, "/api/v1/uploads/"+upload.Id+"/parts/2", "", &presigned); code != http.StatusOK || !strings.Contains(presigned.Url, "partNumber=2") || presigned.ExpiresInSeconds != 900 {
		t.Fatalf("presign: %d %+v", code, presigned)
	}
	var remoteUploadID, objectKey string
	if err := pool.QueryRow(ctx, `SELECT upload_id, object_key FROM attachment WHERE id = $1`, upload.Id).Scan(&remoteUploadID, &objectKey); err != nil {
		t.Fatal(err)
	}
	parts := `{"parts":[{"partNumber":1,"etag":"a"},{"partNumber":2,"etag":"b"},{"partNumber":3,"etag":"c"}]}`
	if code := member.do(http.MethodPost, "/api/v1/uploads/"+upload.Id+"/complete", `{"parts":[{"partNumber":1,"etag":"a"}]}`, nil); code != http.StatusBadRequest {
		t.Fatalf("incomplete part list: %d", code)
	}
	if code := member.do(http.MethodPost, "/api/v1/uploads/"+upload.Id+"/complete", parts, nil); code != http.StatusBadRequest {
		t.Fatalf("parts never sent to the bucket: %d", code)
	}
	memory.PutPart(remoteUploadID, 1, 8<<20)
	memory.PutPart(remoteUploadID, 2, 8<<20)
	memory.PutPart(remoteUploadID, 3, 4<<20)
	var ready struct {
		Id   string
		Size int64
		Name string
	}
	if code := member.do(http.MethodPost, "/api/v1/uploads/"+upload.Id+"/complete", parts, &ready); code != http.StatusOK || ready.Size != size || ready.Name != "relatório.pdf" {
		t.Fatalf("complete: %d %+v", code, ready)
	}
	if code := member.do(http.MethodPost, "/api/v1/uploads/"+upload.Id+"/complete", parts, nil); code != http.StatusOK {
		t.Fatalf("complete must be idempotent: %d", code)
	}

	// Listing and downloads are authorized on every request.
	var listed []struct{ Id string }
	if code := external.do(http.MethodGet, "/api/v1/work-items/"+task.Id+"/attachments", "", &listed); code != http.StatusOK || len(listed) != 1 {
		t.Fatalf("external list: %d %+v", code, listed)
	}
	if code := outsider.do(http.MethodGet, "/api/v1/work-items/"+task.Id+"/attachments", "", nil); code != http.StatusNotFound {
		t.Fatalf("outsider list: %d", code)
	}
	if code := member.do(http.MethodGet, "/api/v1/attachments/"+ready.Id+"/download", "", &presigned); code != http.StatusOK || presigned.ExpiresInSeconds != 60 || !strings.Contains(presigned.Url, "ttl=60") {
		t.Fatalf("download: %d %+v", code, presigned)
	}
	if code := outsider.do(http.MethodGet, "/api/v1/attachments/"+ready.Id+"/download", "", nil); code != http.StatusNotFound {
		t.Fatalf("outsider download: %d", code)
	}
	if code := admin.do(http.MethodPut, base+"/external-policy", `{"version":1,"permissions":["work.read","work.comment"]}`, nil); code != http.StatusOK {
		t.Fatalf("policy: %d", code)
	}
	if code := external.do(http.MethodGet, "/api/v1/attachments/"+ready.Id+"/download", "", nil); code != http.StatusForbidden {
		t.Fatalf("external download without files.download: %d", code)
	}
	if code := external.do(http.MethodPost, "/api/v1/uploads", body(10), nil); code != http.StatusForbidden {
		t.Fatalf("external upload without files.upload: %d", code)
	}
	if code := external.do(http.MethodDelete, "/api/v1/attachments/"+ready.Id, "", nil); code != http.StatusForbidden {
		t.Fatalf("non-uploader delete: %d", code)
	}
	if code := admin.do(http.MethodDelete, "/api/v1/attachments/"+ready.Id, "", nil); code != http.StatusNoContent {
		t.Fatalf("manager delete: %d", code)
	}
	// The object outlives the deletion by 30 days, so a database restore still finds it.
	if !memory.Has(objectKey) {
		t.Fatal("a deleted attachment keeps its object for 30 days")
	}
	if err := jobs.ReleaseStorage(ctx, pool, memory); err != nil {
		t.Fatal(err)
	}
	if !memory.Has(objectKey) {
		t.Fatal("the cleanup must wait for the 30 days")
	}
	if _, err := pool.Exec(ctx, `UPDATE attachment SET released_at = now() - interval '31 days' WHERE id = $1`, ready.Id); err != nil {
		t.Fatal(err)
	}
	if err := jobs.ReleaseStorage(ctx, pool, memory); err != nil {
		t.Fatal(err)
	}
	if memory.Has(objectKey) {
		t.Fatal("after 30 days the deleted attachment must release its object")
	}
	if code := member.do(http.MethodGet, "/api/v1/attachments/"+ready.Id+"/download", "", nil); code != http.StatusNotFound {
		t.Fatalf("download after delete: %d", code)
	}

	// A bucket object whose size differs from the reservation is rejected and discarded.
	var mismatch uploadDTO
	if code := member.do(http.MethodPost, "/api/v1/uploads", body(1000), &mismatch); code != http.StatusCreated {
		t.Fatalf("create: %d", code)
	}
	if err := pool.QueryRow(ctx, `SELECT upload_id FROM attachment WHERE id = $1`, mismatch.Id).Scan(&remoteUploadID); err != nil {
		t.Fatal(err)
	}
	memory.PutPart(remoteUploadID, 1, 999)
	if code := member.do(http.MethodPost, "/api/v1/uploads/"+mismatch.Id+"/complete", `{"parts":[{"partNumber":1,"etag":"a"}]}`, nil); code != http.StatusBadRequest {
		t.Fatalf("size mismatch: %d", code)
	}
	var state string
	if err := pool.QueryRow(ctx, `SELECT state FROM attachment WHERE id = $1`, mismatch.Id).Scan(&state); err != nil || state != "deleted" {
		t.Fatalf("mismatched upload state: %s %v", state, err)
	}

	// Aborting releases the reservation and the multipart upload.
	var aborted uploadDTO
	member.do(http.MethodPost, "/api/v1/uploads", body(1000), &aborted)
	if memory.OpenUploads() != 1 {
		t.Fatalf("expected one open multipart upload, got %d", memory.OpenUploads())
	}
	if code := member.do(http.MethodPost, "/api/v1/uploads/"+aborted.Id+"/abort", "", nil); code != http.StatusNoContent || memory.OpenUploads() != 0 {
		t.Fatalf("abort: %d open=%d", code, memory.OpenUploads())
	}

	// Abandoned uploads expire after 24 hours and are reconciled by the worker job.
	var abandoned uploadDTO
	if code := member.do(http.MethodPost, "/api/v1/uploads", body(1000), &abandoned); code != http.StatusCreated {
		t.Fatalf("create abandoned: %d", code)
	}
	if _, err := pool.Exec(ctx, `UPDATE attachment SET created_at = now() - interval '25 hours' WHERE id = $1`, abandoned.Id); err != nil {
		t.Fatal(err)
	}
	if err := jobs.ReleaseStorage(ctx, pool, memory); err != nil {
		t.Fatal(err)
	}
	var removed bool
	if err := pool.QueryRow(ctx, `SELECT state = 'aborted' AND object_removed FROM attachment WHERE id = $1`, abandoned.Id).Scan(&removed); err != nil || !removed || memory.OpenUploads() != 0 {
		t.Fatalf("expired upload not reconciled: %v %v open=%d", removed, err, memory.OpenUploads())
	}
	if code := member.do(http.MethodPost, "/api/v1/uploads", body(1000), nil); code != http.StatusCreated {
		t.Fatalf("a new upload must be possible after expiry: %d", code)
	}
}
