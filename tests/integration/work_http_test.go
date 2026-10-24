//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi"
	"github.com/GuilhermeVgl/oddkin-comms/internal/identity"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type workClient struct {
	t       *testing.T
	handler http.Handler
	session *http.Cookie
	csrf    *http.Cookie
}

func (c *workClient) do(method, path, body string, out any) int {
	c.t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Host = "oddkin.test"
	req.Header.Set("Origin", "http://oddkin.test")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.AddCookie(c.session)
	req.Header.Set("X-CSRF-Token", c.csrf.Value)
	result := httptest.NewRecorder()
	c.handler.ServeHTTP(result, req)
	if out != nil && result.Code < 300 {
		if err := json.Unmarshal(result.Body.Bytes(), out); err != nil {
			c.t.Fatalf("%s %s: decode %q: %v", method, path, result.Body.String(), err)
		}
	}
	return result.Code
}

func TestWorkProjectsAuthorizationAndRules(t *testing.T) {
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
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ('75000000-0000-4000-8000-000000000001', 'UTC') RETURNING id`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	emails := []string{"work-admin@example.test", "work-member@example.test", "work-outsider@example.test", "work-external@example.test"}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized LIKE 'work-%@example.test'`)
	}()
	passwordHash, err := identity.HashPassword("correct work password")
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
		if email == "work-external@example.test" {
			kind = "external"
		}
		if _, createErr = queries.CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{
			OrganizationID: organizationID, AccountID: account.ID, MembershipKind: kind, IsAdmin: email == "work-admin@example.test",
		}); createErr != nil {
			t.Fatal(createErr)
		}
	}
	handler, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	login := func(email string) *workClient {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"email":"`+email+`","password":"correct work password"}`))
		req.Host = "oddkin.test"
		req.Header.Set("Origin", "http://oddkin.test")
		req.Header.Set("Content-Type", "application/json")
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		if result.Code != http.StatusNoContent {
			t.Fatalf("login %s: %d", email, result.Code)
		}
		client := &workClient{t: t, handler: handler}
		for _, cookie := range result.Result().Cookies() {
			switch cookie.Name {
			case "oddkin_session":
				client.session = cookie
			case "oddkin_csrf":
				client.csrf = cookie
			}
		}
		return client
	}
	admin, member, outsider, external := login(emails[0]), login(emails[1]), login(emails[2]), login(emails[3])

	type project struct{ Id string }
	type column struct {
		Id       string
		Category string
	}
	type item struct {
		Id      string
		Version int
		Column  string `json:"columnId"`
	}

	if code := member.do(http.MethodPost, "/api/v1/projects", `{"name":"Nope"}`, nil); code != http.StatusForbidden {
		t.Fatalf("non-admin created project: %d", code)
	}
	var created project
	if code := admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Alpha"}`, &created); code != http.StatusCreated {
		t.Fatalf("create project: %d", code)
	}
	base := "/api/v1/projects/" + created.Id
	var columns []column
	if code := admin.do(http.MethodGet, base+"/columns", "", &columns); code != http.StatusOK || len(columns) != 4 {
		t.Fatalf("columns: %d %v", code, columns)
	}
	todo, done := columns[0].Id, columns[3].Id

	// Isolation: non-members cannot tell the project exists.
	for _, path := range []string{base, base + "/columns", base + "/work-items", base + "/members", base + "/external-policy"} {
		if code := outsider.do(http.MethodGet, path, "", nil); code != http.StatusNotFound {
			t.Fatalf("outsider GET %s: %d", path, code)
		}
	}
	var visible []project
	if outsider.do(http.MethodGet, "/api/v1/projects", "", &visible); len(visible) != 0 {
		t.Fatalf("outsider sees projects: %v", visible)
	}
	if code := admin.do(http.MethodPost, base+"/members", `{"email":"work-member@example.test"}`, nil); code != http.StatusNoContent {
		t.Fatalf("add member: %d", code)
	}
	if code := admin.do(http.MethodPost, base+"/members", `{"email":"work-external@example.test","isManager":true}`, nil); code != http.StatusNoContent {
		t.Fatalf("add external: %d", code)
	}
	var isManager bool
	if err := pool.QueryRow(ctx, `SELECT is_manager FROM project_member pm JOIN account a ON a.id = pm.account_id WHERE a.email_normalized = 'work-external@example.test'`).Scan(&isManager); err != nil || isManager {
		t.Fatalf("external must never become manager: %v %v", isManager, err)
	}
	if code := member.do(http.MethodPost, base+"/members", `{"email":"work-outsider@example.test"}`, nil); code != http.StatusForbidden {
		t.Fatalf("non-manager added member: %d", code)
	}

	// Work hierarchy and optimistic versioning.
	var task, subtask item
	if code := member.do(http.MethodPost, base+"/work-items", `{"kind":"task","title":"Entregar v1"}`, &task); code != http.StatusCreated || task.Column != todo {
		t.Fatalf("create task: %d %+v", code, task)
	}
	if code := member.do(http.MethodPost, base+"/work-items", `{"kind":"subtask","title":"Passo"}`, nil); code != http.StatusBadRequest {
		t.Fatalf("subtask without parent: %d", code)
	}
	if code := member.do(http.MethodPost, base+"/work-items", `{"kind":"subtask","title":"Passo","parentId":"`+task.Id+`"}`, &subtask); code != http.StatusCreated {
		t.Fatalf("create subtask: %d", code)
	}
	if code := member.do(http.MethodPost, base+"/work-items", `{"kind":"subtask","title":"Neto","parentId":"`+subtask.Id+`"}`, nil); code != http.StatusBadRequest {
		t.Fatalf("subtask of subtask: %d", code)
	}
	var edited item
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+task.Id, `{"version":1,"title":"Entregar v1 hoje"}`, &edited); code != http.StatusOK || edited.Version != 2 {
		t.Fatalf("edit: %d %+v", code, edited)
	}
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+task.Id, `{"version":1,"title":"stale"}`, nil); code != http.StatusConflict {
		t.Fatalf("stale edit: %d", code)
	}

	// Completion rules.
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+task.Id, `{"version":2,"columnId":"`+done+`"}`, nil); code != http.StatusConflict {
		t.Fatalf("done with open subtask: %d", code)
	}
	var finished item
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+task.Id, `{"version":2,"columnId":"`+done+`","completeSubtasks":true}`, &finished); code != http.StatusOK || finished.Column != done {
		t.Fatalf("complete all: %d %+v", code, finished)
	}
	var subtaskColumn string
	if err := pool.QueryRow(ctx, `SELECT column_id::text FROM work_item WHERE id = $1`, subtask.Id).Scan(&subtaskColumn); err != nil || subtaskColumn != done {
		t.Fatalf("subtask not completed: %s %v", subtaskColumn, err)
	}
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+subtask.Id, `{"version":2,"columnId":"`+todo+`"}`, nil); code != http.StatusOK {
		t.Fatalf("reopen subtask: %d", code)
	}
	var parentColumn string
	var inProgress string
	if err := pool.QueryRow(ctx, `SELECT w.column_id::text, (SELECT id::text FROM board_column WHERE project_id = w.project_id AND category = 'in_progress' ORDER BY position LIMIT 1) FROM work_item w WHERE w.id = $1`, task.Id).Scan(&parentColumn, &inProgress); err != nil || parentColumn != inProgress {
		t.Fatalf("parent not reopened to in_progress: %s vs %s (%v)", parentColumn, inProgress, err)
	}

	// External policy: read + comment by default, nothing else.
	if code := external.do(http.MethodGet, base+"/work-items", "", nil); code != http.StatusOK {
		t.Fatalf("external read: %d", code)
	}
	if code := external.do(http.MethodPost, base+"/work-items", `{"kind":"task","title":"x"}`, nil); code != http.StatusForbidden {
		t.Fatalf("external create: %d", code)
	}
	if code := external.do(http.MethodPost, "/api/v1/work-items/"+task.Id+"/comments", `{"body":"Olá"}`, nil); code != http.StatusCreated {
		t.Fatalf("external comment: %d", code)
	}
	if code := external.do(http.MethodPut, base+"/external-policy", `{"version":1,"permissions":["work.read","work.edit"]}`, nil); code != http.StatusForbidden {
		t.Fatalf("external changed policy: %d", code)
	}
	if code := admin.do(http.MethodPut, base+"/external-policy", `{"version":1,"permissions":["work.edit"]}`, nil); code != http.StatusBadRequest {
		t.Fatalf("policy without read: %d", code)
	}
	if code := admin.do(http.MethodPut, base+"/external-policy", `{"version":1,"permissions":["work.read","work.create"]}`, nil); code != http.StatusOK {
		t.Fatalf("policy update: %d", code)
	}
	if code := admin.do(http.MethodPut, base+"/external-policy", `{"version":1,"permissions":["work.read"]}`, nil); code != http.StatusConflict {
		t.Fatalf("stale policy: %d", code)
	}
	if code := external.do(http.MethodPost, base+"/work-items", `{"kind":"task","title":"x"}`, nil); code != http.StatusCreated {
		t.Fatalf("external create after policy: %d", code)
	}
	if code := external.do(http.MethodPost, "/api/v1/work-items/"+task.Id+"/comments", `{"body":"Olá"}`, nil); code != http.StatusForbidden {
		t.Fatalf("comment after revoke: %d", code)
	}
	if code := outsider.do(http.MethodPatch, "/api/v1/work-items/"+task.Id, `{"version":9,"title":"x"}`, nil); code != http.StatusNotFound {
		t.Fatalf("outsider patch: %d", code)
	}

	// Chat: isolation, idempotent retries and gap-free ordering under concurrency.
	type channel struct{ Id, Name string }
	type message struct {
		Id  string
		Seq int64
	}
	var channels []channel
	if code := member.do(http.MethodGet, base+"/conversations", "", &channels); code != http.StatusOK || len(channels) != 1 || channels[0].Name != "geral" {
		t.Fatalf("channels: %d %v", code, channels)
	}
	if code := outsider.do(http.MethodGet, base+"/conversations", "", nil); code != http.StatusNotFound {
		t.Fatalf("outsider channels: %d", code)
	}
	messagesPath := "/api/v1/conversations/" + channels[0].Id + "/messages"
	if code := outsider.do(http.MethodGet, messagesPath, "", nil); code != http.StatusNotFound {
		t.Fatalf("outsider messages: %d", code)
	}
	if code := outsider.do(http.MethodPost, messagesPath, `{"body":"x","clientMutationId":"00000000-0000-4000-8000-0000000000aa"}`, nil); code != http.StatusNotFound {
		t.Fatalf("outsider send: %d", code)
	}
	if code := admin.do(http.MethodPut, base+"/external-policy", `{"version":2,"permissions":["work.read","chat.read","chat.send"]}`, nil); code != http.StatusOK {
		t.Fatalf("grant chat: %d", code)
	}
	first, retry := message{}, message{}
	body := `{"body":"Olá, time","clientMutationId":"00000000-0000-4000-8000-000000000001"}`
	if code := member.do(http.MethodPost, messagesPath, body, &first); code != http.StatusCreated || first.Seq != 1 {
		t.Fatalf("send: %d %+v", code, first)
	}
	if code := member.do(http.MethodPost, messagesPath, body, &retry); code != http.StatusOK || retry.Id != first.Id {
		t.Fatalf("retry must return the original: %d %+v", code, retry)
	}
	if code := external.do(http.MethodPost, messagesPath, `{"body":"Oi","clientMutationId":"00000000-0000-4000-8000-000000000001"}`, nil); code != http.StatusCreated {
		t.Fatalf("same mutation id from another author is independent: %d", code)
	}
	results := make(chan message, 10)
	codes := make(chan int, 10)
	for i := 0; i < 10; i++ {
		go func(n int) {
			var sent message
			codes <- member.do(http.MethodPost, messagesPath, fmt.Sprintf(`{"body":"m%d","clientMutationId":"00000000-0000-4000-8000-0000000001%02d"}`, n, n), &sent)
			results <- sent
		}(i)
	}
	seen := map[int64]bool{}
	for i := 0; i < 10; i++ {
		if code := <-codes; code != http.StatusCreated {
			t.Fatalf("concurrent send: %d", code)
		}
		seen[(<-results).Seq] = true
	}
	for seq := int64(3); seq <= 12; seq++ {
		if !seen[seq] {
			t.Fatalf("sequence gap or duplicate; seen=%v", seen)
		}
	}
	var page []message
	if code := member.do(http.MethodGet, messagesPath+"?after=10&limit=5", "", &page); code != http.StatusOK || len(page) != 2 || page[0].Seq != 11 {
		t.Fatalf("page: %d %+v", code, page)
	}
	if code := admin.do(http.MethodPut, base+"/external-policy", `{"version":3,"permissions":["work.read"]}`, nil); code != http.StatusOK {
		t.Fatalf("drop chat from policy: %d", code)
	}
	if code := external.do(http.MethodGet, messagesPath, "", nil); code != http.StatusForbidden {
		t.Fatalf("external read after revoke: %d", code)
	}

	// Epics: planning permission, explicit closing and automatic reopening.
	type epicDTO struct {
		Id      string
		Version int
		Done    bool
	}
	var epicRow epicDTO
	if code := external.do(http.MethodPost, base+"/epics", `{"title":"Nope"}`, nil); code != http.StatusForbidden {
		t.Fatalf("external created epic: %d", code)
	}
	if code := member.do(http.MethodPost, base+"/epics", `{"title":"Lançamento"}`, &epicRow); code != http.StatusCreated {
		t.Fatalf("create epic: %d", code)
	}
	current := func(id string) item {
		var all []item
		if code := member.do(http.MethodGet, base+"/work-items", "", &all); code != http.StatusOK {
			t.Fatalf("list items: %d", code)
		}
		for _, candidate := range all {
			if candidate.Id == id {
				return candidate
			}
		}
		t.Fatalf("item %s not listed", id)
		return item{}
	}
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+task.Id, fmt.Sprintf(`{"version":%d,"epicId":%q}`, current(task.Id).Version, epicRow.Id), nil); code != http.StatusOK {
		t.Fatalf("link epic: %d", code)
	}
	if code := member.do(http.MethodPatch, "/api/v1/epics/"+epicRow.Id, `{"version":1,"done":true}`, nil); code != http.StatusConflict {
		t.Fatalf("close epic with open task: %d", code)
	}
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+task.Id, fmt.Sprintf(`{"version":%d,"columnId":%q,"completeSubtasks":true}`, current(task.Id).Version, done), nil); code != http.StatusOK {
		t.Fatalf("complete task: %d", code)
	}
	if code := member.do(http.MethodPatch, "/api/v1/epics/"+epicRow.Id, `{"version":1,"done":true}`, &epicRow); code != http.StatusOK || !epicRow.Done {
		t.Fatalf("close epic: %d %+v", code, epicRow)
	}
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+subtask.Id, fmt.Sprintf(`{"version":%d,"columnId":%q}`, current(subtask.Id).Version, todo), nil); code != http.StatusOK {
		t.Fatalf("reopen subtask: %d", code)
	}
	var epics []epicDTO
	if code := member.do(http.MethodGet, base+"/epics", "", &epics); code != http.StatusOK || len(epics) != 1 || epics[0].Done {
		t.Fatalf("epic must reopen with its task: %d %+v", code, epics)
	}

	// Sprints: administrator-only planning, single active sprint and complete close decisions.
	type sprintDTO struct {
		Id    string
		State string
	}
	var sprintOne, sprintTwo sprintDTO
	sprintBody := `{"name":"Sprint 1","startsOn":"2026-11-02","endsOn":"2026-11-13"}`
	if code := member.do(http.MethodPost, "/api/v1/sprints", sprintBody, nil); code != http.StatusForbidden {
		t.Fatalf("non-admin planned sprint: %d", code)
	}
	if code := admin.do(http.MethodPost, "/api/v1/sprints", `{"name":"Bad","startsOn":"2026-11-14","endsOn":"2026-11-13"}`, nil); code != http.StatusBadRequest {
		t.Fatalf("inverted dates: %d", code)
	}
	if code := admin.do(http.MethodPost, "/api/v1/sprints", sprintBody, &sprintOne); code != http.StatusCreated || sprintOne.State != "planned" {
		t.Fatalf("plan sprint: %d %+v", code, first)
	}
	if code := admin.do(http.MethodPost, "/api/v1/sprints", `{"name":"Sprint 2","startsOn":"2026-11-16","endsOn":"2026-11-27"}`, &sprintTwo); code != http.StatusCreated {
		t.Fatalf("plan second sprint: %d", code)
	}
	if code := external.do(http.MethodPatch, "/api/v1/work-items/"+task.Id, fmt.Sprintf(`{"version":%d,"sprintId":%q}`, current(task.Id).Version, sprintOne.Id), nil); code != http.StatusForbidden {
		t.Fatalf("external planned sprint: %d", code)
	}
	var extra item
	if code := member.do(http.MethodPost, base+"/work-items", `{"kind":"task","title":"Concluída"}`, &extra); code != http.StatusCreated {
		t.Fatalf("create extra: %d", code)
	}
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+extra.Id, fmt.Sprintf(`{"version":1,"columnId":%q,"sprintId":%q}`, done, sprintOne.Id), nil); code != http.StatusOK {
		t.Fatalf("member must plan sprints and complete work: %d", code)
	}
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+task.Id, fmt.Sprintf(`{"version":%d,"sprintId":%q}`, current(task.Id).Version, sprintOne.Id), nil); code != http.StatusOK {
		t.Fatalf("assign sprint: %d", code)
	}
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+subtask.Id, fmt.Sprintf(`{"version":%d,"sprintId":%q}`, current(subtask.Id).Version, sprintOne.Id), nil); code != http.StatusBadRequest {
		t.Fatalf("subtasks inherit sprints and cannot be assigned: %d", code)
	}
	if code := admin.do(http.MethodPost, "/api/v1/sprints/"+sprintOne.Id+"/start", "", &sprintOne); code != http.StatusOK || sprintOne.State != "active" {
		t.Fatalf("start: %d %+v", code, first)
	}
	if code := admin.do(http.MethodPost, "/api/v1/sprints/"+sprintTwo.Id+"/start", "", nil); code != http.StatusConflict {
		t.Fatalf("second active sprint: %d", code)
	}
	var preview struct {
		Completed, Pending []item
		Blocked            bool
	}
	if code := admin.do(http.MethodGet, "/api/v1/sprints/"+sprintOne.Id+"/close-preview", "", &preview); code != http.StatusOK || len(preview.Pending) != 1 || preview.Blocked {
		t.Fatalf("preview: %d %+v", code, preview)
	}
	closePath := "/api/v1/sprints/" + sprintOne.Id + "/close"
	pendingVersion := preview.Pending[0].Version
	if code := admin.do(http.MethodPost, closePath, `{"decisions":[]}`, nil); code != http.StatusBadRequest {
		t.Fatalf("close without decision: %d", code)
	}
	stale := fmt.Sprintf(`{"destinationSprintId":%q,"decisions":[{"workItemId":%q,"version":%d,"destination":"next"}]}`, sprintTwo.Id, task.Id, pendingVersion-1)
	if code := admin.do(http.MethodPost, closePath, stale, nil); code != http.StatusConflict {
		t.Fatalf("close with stale version: %d", code)
	}
	if code := member.do(http.MethodPost, closePath, `{"decisions":[]}`, nil); code != http.StatusForbidden {
		t.Fatalf("non-admin closed sprint: %d", code)
	}
	good := fmt.Sprintf(`{"destinationSprintId":%q,"decisions":[{"workItemId":%q,"version":%d,"destination":"next"}]}`, sprintTwo.Id, task.Id, pendingVersion)
	if code := admin.do(http.MethodPost, closePath, good, nil); code != http.StatusNoContent {
		t.Fatalf("close: %d", code)
	}
	var carriedTo string
	if err := pool.QueryRow(ctx, `SELECT sprint_id::text FROM work_item WHERE id = $1`, task.Id).Scan(&carriedTo); err != nil || carriedTo != sprintTwo.Id {
		t.Fatalf("task not carried: %s %v", carriedTo, err)
	}
	var history int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM sprint_item_history WHERE sprint_id = $1`, sprintOne.Id).Scan(&history); err != nil || history != 2 {
		t.Fatalf("history rows: %d %v", history, err)
	}
	if code := admin.do(http.MethodPost, closePath, good, nil); code != http.StatusConflict {
		t.Fatalf("closing twice: %d", code)
	}

	// DMs, replies, reactions, edits and deletion.
	type dmDTO struct {
		Id     string
		PeerId string
	}
	type contactDTO struct{ AccountId, Email string }
	type msgDTO struct {
		Id        string
		Seq       int64
		Body      string
		Deleted   bool
		ReplyToId string
		EditedAt  string
		Reactions []struct {
			Emoji string
			Count int
			Mine  bool
		}
	}
	if code := admin.do(http.MethodPut, base+"/external-policy", `{"version":4,"permissions":["work.read","chat.read","chat.send","direct_messages.use"]}`, nil); code != http.StatusOK {
		t.Fatalf("restore chat policy: %d", code)
	}
	var contacts []contactDTO
	if code := member.do(http.MethodGet, "/api/v1/direct-contacts", "", &contacts); code != http.StatusOK || len(contacts) != 2 {
		t.Fatalf("member contacts: %d %v", code, contacts)
	}
	if code := outsider.do(http.MethodGet, "/api/v1/direct-contacts", "", &contacts); code != http.StatusOK || len(contacts) != 0 {
		t.Fatalf("outsider must have no contacts: %d %v", code, contacts)
	}
	var memberID, outsiderID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM account WHERE email_normalized = 'work-member@example.test'`).Scan(&memberID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT id::text FROM account WHERE email_normalized = 'work-outsider@example.test'`).Scan(&outsiderID); err != nil {
		t.Fatal(err)
	}
	var extID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM account WHERE email_normalized = 'work-external@example.test'`).Scan(&extID); err != nil {
		t.Fatal(err)
	}
	if code := outsider.do(http.MethodPost, "/api/v1/direct-conversations", `{"accountId":"`+memberID+`"}`, nil); code != http.StatusForbidden {
		t.Fatalf("DM without shared project: %d", code)
	}
	var dm, dmAgain dmDTO
	if code := external.do(http.MethodPost, "/api/v1/direct-conversations", `{"accountId":"`+memberID+`"}`, &dm); code != http.StatusCreated {
		t.Fatalf("open DM: %d", code)
	}
	if code := member.do(http.MethodPost, "/api/v1/direct-conversations", `{"accountId":"`+extID+`"}`, &dmAgain); code != http.StatusOK || dmAgain.Id != dm.Id {
		t.Fatalf("DM must be one canonical conversation: %d %+v %+v", code, dm, dmAgain)
	}
	dmPath := "/api/v1/conversations/" + dm.Id + "/messages"
	if code := outsider.do(http.MethodGet, dmPath, "", nil); code != http.StatusNotFound {
		t.Fatalf("third party reads DM: %d", code)
	}
	if code := admin.do(http.MethodGet, dmPath, "", nil); code != http.StatusNotFound {
		t.Fatalf("admin reads DM: %d", code)
	}
	var hello, answer msgDTO
	if code := external.do(http.MethodPost, dmPath, `{"body":"Oi","clientMutationId":"00000000-0000-4000-8000-0000000002a1"}`, &hello); code != http.StatusCreated {
		t.Fatalf("DM send: %d", code)
	}
	if code := member.do(http.MethodPost, dmPath, fmt.Sprintf(`{"body":"Oi!","clientMutationId":"00000000-0000-4000-8000-0000000002a2","replyToId":%q}`, hello.Id), &answer); code != http.StatusCreated || answer.ReplyToId != hello.Id {
		t.Fatalf("DM reply: %d %+v", code, answer)
	}
	if code := member.do(http.MethodPost, messagesPath, fmt.Sprintf(`{"body":"x","clientMutationId":"00000000-0000-4000-8000-0000000002a3","replyToId":%q}`, hello.Id), nil); code != http.StatusBadRequest {
		t.Fatalf("reply across conversations: %d", code)
	}
	reactPath := "/api/v1/messages/" + hello.Id + "/reactions"
	var summary []struct {
		Emoji string
		Count int
		Mine  bool
	}
	if code := member.do(http.MethodPost, reactPath, `{"emoji":"👍"}`, &summary); code != http.StatusOK || len(summary) != 1 || summary[0].Count != 1 || !summary[0].Mine {
		t.Fatalf("react: %d %+v", code, summary)
	}
	if code := external.do(http.MethodPost, reactPath, `{"emoji":"👍"}`, &summary); code != http.StatusOK || summary[0].Count != 2 {
		t.Fatalf("second reaction: %d %+v", code, summary)
	}
	if code := member.do(http.MethodPost, reactPath, `{"emoji":"👍"}`, &summary); code != http.StatusOK || summary[0].Count != 1 || summary[0].Mine {
		t.Fatalf("reaction toggles off: %d %+v", code, summary)
	}
	if code := outsider.do(http.MethodPost, reactPath, `{"emoji":"👍"}`, nil); code != http.StatusNotFound {
		t.Fatalf("outsider reacts: %d", code)
	}
	if code := member.do(http.MethodPatch, "/api/v1/messages/"+hello.Id, `{"body":"hack"}`, nil); code != http.StatusForbidden {
		t.Fatalf("edit someone else's message: %d", code)
	}
	var editedMsg msgDTO
	if code := external.do(http.MethodPatch, "/api/v1/messages/"+hello.Id, `{"body":"Olá"}`, &editedMsg); code != http.StatusOK || editedMsg.Body != "Olá" || editedMsg.EditedAt == "" {
		t.Fatalf("edit: %d %+v", code, editedMsg)
	}
	if code := admin.do(http.MethodDelete, "/api/v1/messages/"+hello.Id, "", nil); code != http.StatusNotFound {
		t.Fatalf("admin moderates DM: %d", code)
	}
	if code := external.do(http.MethodDelete, "/api/v1/messages/"+hello.Id, "", nil); code != http.StatusNoContent {
		t.Fatalf("delete own: %d", code)
	}
	var listed []msgDTO
	if code := member.do(http.MethodGet, dmPath, "", &listed); code != http.StatusOK || len(listed) != 2 || !listed[0].Deleted || listed[0].Body != "" || len(listed[0].Reactions) != 0 {
		t.Fatalf("tombstone: %d %+v", code, listed)
	}
	if code := external.do(http.MethodPatch, "/api/v1/messages/"+hello.Id, `{"body":"again"}`, nil); code != http.StatusConflict {
		t.Fatalf("edit tombstone: %d", code)
	}
	// Channel moderation: a manager may delete a channel message, a peer may not.
	var moderated msgDTO
	if code := external.do(http.MethodPost, messagesPath, `{"body":"moderar","clientMutationId":"00000000-0000-4000-8000-0000000002b1"}`, &moderated); code != http.StatusCreated {
		t.Fatalf("channel send: %d", code)
	}
	if code := member.do(http.MethodDelete, "/api/v1/messages/"+moderated.Id, "", nil); code != http.StatusForbidden {
		t.Fatalf("peer moderated channel: %d", code)
	}
	if code := admin.do(http.MethodDelete, "/api/v1/messages/"+moderated.Id, "", nil); code != http.StatusNoContent {
		t.Fatalf("manager moderation: %d", code)
	}
	// Losing every eligible context blocks the DM through the server.
	if code := admin.do(http.MethodPut, base+"/external-policy", `{"version":5,"permissions":["work.read","chat.read","chat.send"]}`, nil); code != http.StatusOK {
		t.Fatalf("revoke DM permission: %d", code)
	}
	if code := external.do(http.MethodGet, dmPath, "", nil); code != http.StatusForbidden {
		t.Fatalf("DM after revoke: %d", code)
	}
	_ = outsiderID
}
