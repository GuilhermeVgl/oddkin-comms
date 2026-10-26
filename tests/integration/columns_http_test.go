//go:build integration

package integration

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi"
	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Board columns are changed only by project managers, one transaction at a
// time, and the board always keeps a column for open work and one for done work.
func TestBoardColumnManagementAndPermissions(t *testing.T) {
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
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ('75000000-0000-4000-8000-000000000031', 'UTC') RETURNING id`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	emails := []string{"col-admin@example.test", "col-member@example.test", "col-outsider@example.test", "col-external@example.test"}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized LIKE 'col-%@example.test'`)
	}()
	passwordHash, err := identity.HashPassword("correct column password")
	if err != nil {
		t.Fatal(err)
	}
	queries := sqlc.New(pool)
	for _, email := range emails {
		account, createErr := queries.CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: email, PasswordHash: passwordHash})
		if createErr != nil {
			t.Fatal(createErr)
		}
		kind := "internal"
		if email == "col-external@example.test" {
			kind = "external"
		}
		if _, createErr = queries.CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{
			OrganizationID: organizationID, AccountID: account.ID, MembershipKind: kind, IsAdmin: email == "col-admin@example.test",
		}); createErr != nil {
			t.Fatal(createErr)
		}
	}
	handler, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	login := func(email string) *workClient {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"email":"`+email+`","password":"correct column password"}`))
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
	admin, member, outsider, external := login(emails[0]), login(emails[1]), login(emails[2]), login(emails[3])

	type column struct {
		Id       string
		Name     string
		Position int
		Category string
	}
	type project struct {
		Id          string
		Permissions []string
	}
	type item struct {
		Id       string
		Version  int
		ColumnId string
	}

	var created project
	if code := admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Columns"}`, &created); code != http.StatusCreated {
		t.Fatalf("create project: %d", code)
	}
	if len(created.Permissions) != 15 {
		t.Fatalf("an internal manager holds every permission, got %v", created.Permissions)
	}
	base := "/api/v1/projects/" + created.Id
	for _, email := range []string{"col-member@example.test", "col-external@example.test"} {
		if code := admin.do(http.MethodPost, base+"/members", fmt.Sprintf(`{"email":%q}`, email), nil); code != http.StatusNoContent {
			t.Fatalf("add %s: %d", email, code)
		}
	}

	// What the caller may do travels with the project, and externals only get the shared policy.
	var policy struct{ Version int }
	if code := admin.do(http.MethodGet, base+"/external-policy", "", &policy); code != http.StatusOK {
		t.Fatalf("policy: %d", code)
	}
	if code := admin.do(http.MethodPut, base+"/external-policy", fmt.Sprintf(`{"permissions":["work.read","work.comment"],"version":%d}`, policy.Version), nil); code != http.StatusOK {
		t.Fatalf("set policy: %d", code)
	}
	var seenByExternal []project
	if code := external.do(http.MethodGet, "/api/v1/projects", "", &seenByExternal); code != http.StatusOK || len(seenByExternal) != 1 {
		t.Fatalf("external list: %d %v", code, seenByExternal)
	}
	if !slices.Equal(seenByExternal[0].Permissions, []string{"work.comment", "work.read"}) {
		t.Fatalf("external permissions: %v", seenByExternal[0].Permissions)
	}
	var seenByMember project
	if code := member.do(http.MethodGet, base, "", &seenByMember); code != http.StatusOK || len(seenByMember.Permissions) != 15 {
		t.Fatalf("member project: %d %v", code, seenByMember.Permissions)
	}

	var columns []column
	if code := admin.do(http.MethodGet, base+"/columns", "", &columns); code != http.StatusOK || len(columns) != 4 {
		t.Fatalf("columns: %d %v", code, columns)
	}
	todo, doing, review, done := columns[0], columns[1], columns[2], columns[3]

	// Only managers change columns; strangers cannot tell the project exists.
	for _, caller := range []struct {
		who  *workClient
		want int
	}{{member, http.StatusForbidden}, {external, http.StatusForbidden}, {outsider, http.StatusNotFound}} {
		if code := caller.who.do(http.MethodPost, base+"/columns", `{"name":"Nope","category":"todo"}`, nil); code != caller.want {
			t.Fatalf("create as non-manager: %d want %d", code, caller.want)
		}
		if code := caller.who.do(http.MethodPatch, base+"/columns/"+todo.Id, `{"name":"Nope"}`, nil); code != caller.want {
			t.Fatalf("rename as non-manager: %d want %d", code, caller.want)
		}
		if code := caller.who.do(http.MethodDelete, base+"/columns/"+review.Id+"?moveTo="+todo.Id, "", nil); code != caller.want {
			t.Fatalf("delete as non-manager: %d want %d", code, caller.want)
		}
		if code := caller.who.do(http.MethodPut, base+"/columns/order", fmt.Sprintf(`{"columnIds":[%q,%q,%q,%q]}`, done.Id, review.Id, doing.Id, todo.Id), nil); code != caller.want {
			t.Fatalf("reorder as non-manager: %d want %d", code, caller.want)
		}
	}

	// Create, rename and validate names.
	var added column
	if code := admin.do(http.MethodPost, base+"/columns", `{"name":"  Bloqueado  ","category":"in_progress"}`, &added); code != http.StatusCreated || added.Name != "Bloqueado" || added.Position != 4 {
		t.Fatalf("create column: %d %+v", code, added)
	}
	for _, body := range []string{`{"name":"   ","category":"todo"}`, `{"name":"","category":"todo"}`} {
		if code := admin.do(http.MethodPost, base+"/columns", body, nil); code != http.StatusBadRequest {
			t.Fatalf("invalid name %s: %d", body, code)
		}
	}
	var renamed column
	if code := admin.do(http.MethodPatch, base+"/columns/"+added.Id, `{"name":"Esperando cliente"}`, &renamed); code != http.StatusOK || renamed.Name != "Esperando cliente" {
		t.Fatalf("rename: %d %+v", code, renamed)
	}

	// The board always keeps a done column and an open one.
	if code := admin.do(http.MethodPatch, base+"/columns/"+done.Id, `{"category":"in_progress"}`, nil); code != http.StatusBadRequest {
		t.Fatalf("reclassifying the only done column: %d", code)
	}
	var after []column
	admin.do(http.MethodGet, base+"/columns", "", &after)
	if after[3].Category != "done" {
		t.Fatalf("a rejected change must not stick: %+v", after[3])
	}

	// Deleting a column with work needs a destination and moves it atomically.
	var work item
	if code := admin.do(http.MethodPost, base+"/work-items", fmt.Sprintf(`{"kind":"task","title":"Parada","columnId":%q}`, added.Id), &work); code != http.StatusCreated {
		t.Fatalf("create item: %d", code)
	}
	if code := admin.do(http.MethodDelete, base+"/columns/"+added.Id, "", nil); code != http.StatusBadRequest {
		t.Fatalf("delete with items and no destination: %d", code)
	}
	if code := admin.do(http.MethodDelete, base+"/columns/"+added.Id+"?moveTo="+added.Id, "", nil); code != http.StatusBadRequest {
		t.Fatalf("delete into itself: %d", code)
	}
	if code := admin.do(http.MethodDelete, base+"/columns/"+added.Id+"?moveTo=00000000-0000-4000-8000-000000000000", "", nil); code != http.StatusBadRequest {
		t.Fatalf("delete into a column of nowhere: %d", code)
	}
	if code := admin.do(http.MethodDelete, base+"/columns/"+added.Id+"?moveTo="+doing.Id, "", nil); code != http.StatusNoContent {
		t.Fatalf("delete with destination: %d", code)
	}
	var moved []item
	admin.do(http.MethodGet, base+"/work-items", "", &moved)
	if len(moved) != 1 || moved[0].ColumnId != doing.Id || moved[0].Version != work.Version+1 {
		t.Fatalf("item must move with the column: %+v", moved)
	}

	// Removing the last done column would break the board, and nothing is moved.
	if code := admin.do(http.MethodDelete, base+"/columns/"+done.Id+"?moveTo="+todo.Id, "", nil); code != http.StatusBadRequest {
		t.Fatalf("delete the only done column: %d", code)
	}
	if code := admin.do(http.MethodGet, base+"/columns", "", &after); code != http.StatusOK || len(after) != 4 {
		t.Fatalf("columns after a refused delete: %d %v", code, after)
	}

	// Reordering takes exactly the project's columns.
	if code := admin.do(http.MethodPut, base+"/columns/order", fmt.Sprintf(`{"columnIds":[%q,%q,%q]}`, done.Id, review.Id, doing.Id), nil); code != http.StatusBadRequest {
		t.Fatalf("reorder with a missing column: %d", code)
	}
	if code := admin.do(http.MethodPut, base+"/columns/order", fmt.Sprintf(`{"columnIds":[%q,%q,%q,%q]}`, todo.Id, todo.Id, doing.Id, done.Id), nil); code != http.StatusBadRequest {
		t.Fatalf("reorder with a repeated column: %d", code)
	}
	var reordered []column
	if code := admin.do(http.MethodPut, base+"/columns/order", fmt.Sprintf(`{"columnIds":[%q,%q,%q,%q]}`, doing.Id, todo.Id, review.Id, done.Id), &reordered); code != http.StatusOK {
		t.Fatalf("reorder: %d", code)
	}
	if got := []string{reordered[0].Id, reordered[1].Id, reordered[2].Id, reordered[3].Id}; !slices.Equal(got, []string{doing.Id, todo.Id, review.Id, done.Id}) {
		t.Fatalf("order: %v", got)
	}

	// Channels: managers create, order and archive; archived channels are read-only.
	type channel struct {
		Id       string
		Name     string
		Archived *bool
	}
	if code := member.do(http.MethodPost, base+"/conversations", `{"name":"design"}`, nil); code != http.StatusForbidden {
		t.Fatalf("channel as member: %d", code)
	}
	if code := admin.do(http.MethodPost, base+"/conversations", `{"name":"  "}`, nil); code != http.StatusBadRequest {
		t.Fatalf("blank channel name: %d", code)
	}
	var design channel
	if code := admin.do(http.MethodPost, base+"/conversations", `{"name":"design"}`, &design); code != http.StatusCreated || design.Name != "design" {
		t.Fatalf("create channel: %d %+v", code, design)
	}
	var channels []channel
	admin.do(http.MethodGet, base+"/conversations", "", &channels)
	if len(channels) != 2 || channels[1].Id != design.Id {
		t.Fatalf("new channels go last: %+v", channels)
	}
	if code := admin.do(http.MethodPut, base+"/conversations/order", fmt.Sprintf(`{"ids":[%q]}`, design.Id), nil); code != http.StatusBadRequest {
		t.Fatalf("a partial order must be refused: %d", code)
	}
	if code := admin.do(http.MethodPut, base+"/conversations/order", fmt.Sprintf(`{"ids":[%q,%q]}`, design.Id, channels[0].Id), nil); code != http.StatusNoContent {
		t.Fatalf("reorder: %d", code)
	}
	admin.do(http.MethodGet, base+"/conversations", "", &channels)
	if channels[0].Id != design.Id {
		t.Fatalf("order not applied: %+v", channels)
	}
	if code := member.do(http.MethodPut, "/api/v1/conversations/"+design.Id+"/archive", `{"archived":true}`, nil); code != http.StatusForbidden {
		t.Fatalf("archive as member: %d", code)
	}
	if code := admin.do(http.MethodPut, "/api/v1/conversations/"+design.Id+"/archive", `{"archived":true}`, nil); code != http.StatusNoContent {
		t.Fatalf("archive channel: %d", code)
	}
	if code := admin.do(http.MethodPost, "/api/v1/conversations/"+design.Id+"/messages", `{"body":"oi","clientMutationId":"00000000-0000-4000-8000-0000000000aa"}`, nil); code != http.StatusConflict {
		t.Fatalf("an archived channel is read-only: %d", code)
	}
	if code := admin.do(http.MethodPut, "/api/v1/conversations/"+design.Id+"/archive", `{"archived":false}`, nil); code != http.StatusNoContent {
		t.Fatalf("restore channel: %d", code)
	}

	// Managers choose the project colour; anyone else is refused and the format is checked.
	if code := member.do(http.MethodPut, base+"/appearance", `{"color":"#112233"}`, nil); code != http.StatusForbidden {
		t.Fatalf("colour as member: %d", code)
	}
	if code := admin.do(http.MethodPut, base+"/appearance", `{"color":"red"}`, nil); code != http.StatusBadRequest {
		t.Fatalf("invalid colour: %d", code)
	}
	if code := admin.do(http.MethodPut, base+"/appearance", `{"color":"#112233"}`, nil); code != http.StatusNoContent {
		t.Fatalf("set colour: %d", code)
	}
	var recoloured struct{ Color string }
	if code := member.do(http.MethodGet, base, "", &recoloured); code != http.StatusOK || recoloured.Color != "#112233" {
		t.Fatalf("colour after update: %d %+v", code, recoloured)
	}

	// Only administrators see how much storage is reserved.
	var usage struct{ QuotaBytes, ReservedBytes int64 }
	if code := admin.do(http.MethodGet, "/api/v1/storage/usage", "", &usage); code != http.StatusOK || usage.QuotaBytes != 50_000_000_000 || usage.ReservedBytes != 0 {
		t.Fatalf("storage usage: %d %+v", code, usage)
	}
	if code := member.do(http.MethodGet, "/api/v1/storage/usage", "", nil); code != http.StatusForbidden {
		t.Fatalf("storage usage as member: %d", code)
	}

	// Following: whoever can read an activity can follow it, and followers hear about moves.
	following := "/api/v1/work-items/" + moved[0].Id + "/followers/me"
	var state struct{ Following bool }
	if code := outsider.do(http.MethodPut, following, "", nil); code != http.StatusNotFound {
		t.Fatalf("outsider follows: %d", code)
	}
	if code := external.do(http.MethodGet, following, "", &state); code != http.StatusOK || state.Following {
		t.Fatalf("external before following: %d %v", code, state)
	}
	if code := external.do(http.MethodPut, following, "", nil); code != http.StatusNoContent {
		t.Fatalf("external follows: %d", code)
	}
	if code := external.do(http.MethodGet, following, "", &state); code != http.StatusOK || !state.Following {
		t.Fatalf("external after following: %d %v", code, state)
	}
	if code := member.do(http.MethodPut, following, "", nil); code != http.StatusNoContent {
		t.Fatalf("member follows: %d", code)
	}
	if code := admin.do(http.MethodPatch, "/api/v1/work-items/"+moved[0].Id, fmt.Sprintf(`{"version":%d,"columnId":%q}`, moved[0].Version, todo.Id), nil); code != http.StatusOK {
		t.Fatalf("move: %d", code)
	}
	countUpdates := func(who *workClient) int {
		var list []struct{ Kind string }
		who.do(http.MethodGet, "/api/v1/notifications", "", &list)
		total := 0
		for _, entry := range list {
			if entry.Kind == "followed_update" {
				total++
			}
		}
		return total
	}
	if countUpdates(member) != 1 || countUpdates(external) != 1 {
		t.Fatalf("followers must hear about the move: member=%d external=%d", countUpdates(member), countUpdates(external))
	}
	if countUpdates(admin) != 0 {
		t.Fatal("the person who moved it is not told")
	}
	if code := external.do(http.MethodDelete, following, "", nil); code != http.StatusNoContent {
		t.Fatalf("unfollow: %d", code)
	}
	if code := external.do(http.MethodGet, following, "", &state); code != http.StatusOK || state.Following {
		t.Fatalf("after unfollowing: %d %v", code, state)
	}

	// Removing a member ends their access at once and frees their assignments.
	var members []struct {
		AccountId string
		Email     string
	}
	if code := admin.do(http.MethodGet, base+"/members", "", &members); code != http.StatusOK {
		t.Fatalf("members: %d", code)
	}
	idOf := map[string]string{}
	for _, entry := range members {
		idOf[entry.Email] = entry.AccountId
	}
	var assigned item
	if code := admin.do(http.MethodPost, base+"/work-items", fmt.Sprintf(`{"kind":"task","title":"Do membro","assigneeId":%q}`, idOf["col-member@example.test"]), &assigned); code != http.StatusCreated {
		t.Fatalf("assigned item: %d", code)
	}
	removal := base + "/members/" + idOf["col-member@example.test"]
	for _, caller := range []struct {
		who  *workClient
		want int
	}{{member, http.StatusForbidden}, {external, http.StatusForbidden}, {outsider, http.StatusNotFound}} {
		if code := caller.who.do(http.MethodDelete, removal, "", nil); code != caller.want {
			t.Fatalf("remove as non-manager: %d want %d", code, caller.want)
		}
	}
	if code := admin.do(http.MethodDelete, base+"/members/"+idOf["col-outsider@example.test"], "", nil); code != http.StatusNotFound {
		t.Fatalf("remove someone who is not a member: %d", code)
	}
	if code := admin.do(http.MethodDelete, base+"/members/"+idOf["col-admin@example.test"], "", nil); code != http.StatusConflict {
		t.Fatalf("remove the last manager: %d", code)
	}
	if code := admin.do(http.MethodDelete, removal, "", nil); code != http.StatusNoContent {
		t.Fatalf("remove member: %d", code)
	}
	if code := member.do(http.MethodGet, base, "", nil); code != http.StatusNotFound {
		t.Fatalf("a removed member must lose access at once: %d", code)
	}
	var freed []struct {
		Id         string
		AssigneeId *string
	}
	admin.do(http.MethodGet, base+"/work-items", "", &freed)
	for _, entry := range freed {
		if entry.Id == assigned.Id && entry.AssigneeId != nil {
			t.Fatalf("assignment must be released: %v", *entry.AssigneeId)
		}
	}

	// Archiving a project hides it from the default list, keeps it readable and blocks new work.
	if code := external.do(http.MethodPut, base+"/archive", `{"archived":true}`, nil); code != http.StatusForbidden {
		t.Fatalf("archive as external: %d", code)
	}
	if code := admin.do(http.MethodPut, base+"/archive", `{"archived":true}`, nil); code != http.StatusNoContent {
		t.Fatalf("archive project: %d", code)
	}
	var listed []struct {
		Id       string
		Archived *bool
	}
	hasProject := func(path string) bool {
		listed = nil
		admin.do(http.MethodGet, path, "", &listed)
		for _, entry := range listed {
			if base == "/api/v1/projects/"+entry.Id {
				return true
			}
		}
		return false
	}
	if hasProject("/api/v1/projects") || !hasProject("/api/v1/projects?includeArchived=true") {
		t.Fatal("archived projects appear only on request")
	}
	if code := admin.do(http.MethodGet, base, "", nil); code != http.StatusOK {
		t.Fatalf("an archived project stays readable: %d", code)
	}
	if code := admin.do(http.MethodPost, base+"/work-items", `{"kind":"task","title":"Novo"}`, nil); code != http.StatusConflict {
		t.Fatalf("an archived project takes no new work: %d", code)
	}
	if code := admin.do(http.MethodPut, base+"/archive", `{"archived":false}`, nil); code != http.StatusNoContent || !hasProject("/api/v1/projects") {
		t.Fatalf("restore project: %d", code)
	}
}
