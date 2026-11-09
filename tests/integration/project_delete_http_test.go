//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
)

func TestDeleteProjectCascadesAllProjectData(t *testing.T) {
	ctx, pool := openTestPool(t, 60*time.Second)
	organizationID := newTestOrganization(t, ctx, pool, "75000000-0000-4000-8000-000000000041", "UTC", "delete-%@example.test")
	const password = "correct deletion password"
	emails := []string{"delete-admin@example.test", "delete-member@example.test"}
	createTestMembers(t, ctx, sqlc.New(pool), organizationID, password, emails)
	handler, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	admin := loginClient(t, handler, emails[0], password)
	member := loginClient(t, handler, emails[1], password)

	var project struct{ Id string }
	if code := admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Disposable"}`, &project); code != http.StatusCreated {
		t.Fatalf("create project: %d", code)
	}
	base := "/api/v1/projects/" + project.Id
	if code := admin.do(http.MethodPost, base+"/members", fmt.Sprintf(`{"email":%q}`, emails[1]), nil); code != http.StatusNoContent {
		t.Fatalf("add member: %d", code)
	}
	if code := admin.do(http.MethodPost, base+"/work-items", `{"kind":"task","title":"Temporary task"}`, nil); code != http.StatusCreated {
		t.Fatalf("create work item: %d", code)
	}
	if code := member.do(http.MethodDelete, base, "", nil); code != http.StatusForbidden {
		t.Fatalf("non-admin delete: %d", code)
	}
	if code := admin.do(http.MethodDelete, base, "", nil); code != http.StatusNoContent {
		t.Fatalf("delete project: %d", code)
	}

	for table, query := range map[string]string{
		"project":        `SELECT count(*) FROM project WHERE id = $1::uuid`,
		"project_member": `SELECT count(*) FROM project_member WHERE project_id = $1::uuid`,
		"work_item":      `SELECT count(*) FROM work_item WHERE project_id = $1::uuid`,
		"conversation":   `SELECT count(*) FROM conversation WHERE project_id = $1::uuid`,
	} {
		var count int
		if err := pool.QueryRow(ctx, query, project.Id).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("%s survived cascade: %d", table, count)
		}
	}
	if code := admin.do(http.MethodGet, base, "", nil); code != http.StatusNotFound {
		t.Fatalf("deleted project remains accessible: %d", code)
	}
}
