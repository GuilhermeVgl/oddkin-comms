//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"testing"
)

type statsDTO struct {
	CompletedToday  int
	CompletedTotal  int
	CurrentStreak   int
	BestStreak      int
	KudosReceived   int
	KudosGiven      int
	FocusMinutes    int
	CallsJoined     int
	CommentsWritten int
}

// Finishing work, thanking people for it and focusing on it feed a small
// personal scoreboard. It counts only operational metadata, never content.
func TestStatsKudosAndFocus(t *testing.T) {
	f := newE2EEFixture(t, "81000000-0000-4000-8000-000000000001", "gm", []string{"admin", "ana", "bia", "outsider"})
	admin, ana, bia, outsider := f.clients["admin"], f.clients["ana"], f.clients["bia"], f.clients["outsider"]
	var project struct{ Id string }
	admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Jogo"}`, &project)
	base := "/api/v1/projects/" + project.Id
	admin.do(http.MethodPost, base+"/members", `{"email":"gm-ana@example.test"}`, nil)
	admin.do(http.MethodPost, base+"/members", `{"email":"gm-bia@example.test"}`, nil)
	var columns []struct{ Id, Category string }
	admin.do(http.MethodGet, base+"/columns", "", &columns)
	todo, done := columns[0], columns[len(columns)-1]
	if done.Category != "done" {
		t.Fatalf("expected the last column to be done: %+v", columns)
	}
	var task struct {
		Id      string
		Version int
	}
	body := fmt.Sprintf(`{"kind":"task","title":"Entregar","columnId":%q,"assigneeId":%q}`, todo.Id, f.accounts["ana"])
	if code := admin.do(http.MethodPost, base+"/work-items", body, &task); code != http.StatusCreated {
		t.Fatalf("create: %d", code)
	}
	stats := func(client *workClient) statsDTO {
		var s statsDTO
		if code := client.do(http.MethodGet, "/api/v1/me/stats", "", &s); code != http.StatusOK {
			t.Fatalf("stats: %d", code)
		}
		return s
	}
	if s := stats(ana); s.CompletedTotal != 0 || s.CurrentStreak != 0 {
		t.Fatalf("nothing is done yet: %+v", s)
	}
	itemPath := "/api/v1/work-items/" + task.Id
	if code := bia.do(http.MethodPut, itemPath+"/kudos", "", nil); code != http.StatusConflict {
		t.Fatalf("thanking for work that is not done: %d", code)
	}

	move := func(client *workClient, column string) {
		t.Helper()
		var moved struct{ Version int }
		if code := client.do(http.MethodPatch, itemPath, fmt.Sprintf(`{"version":%d,"columnId":%q}`, task.Version, column), &moved); code != http.StatusOK {
			t.Fatalf("move: %d", code)
		}
		task.Version = moved.Version
	}
	move(ana, done.Id)
	if s := stats(ana); s.CompletedToday != 1 || s.CompletedTotal != 1 || s.CurrentStreak != 1 || s.BestStreak != 1 {
		t.Fatalf("finishing today starts a streak: %+v", s)
	}
	move(ana, todo.Id)
	if s := stats(ana); s.CompletedTotal != 0 || s.CurrentStreak != 0 {
		t.Fatalf("reopening takes the credit back: %+v", s)
	}
	move(ana, done.Id)

	// Thanks: only for finished work, never for yourself, idempotent, visible
	// only to people who can read the activity.
	if code := ana.do(http.MethodPut, itemPath+"/kudos", "", nil); code != http.StatusForbidden {
		t.Fatalf("thanking yourself: %d", code)
	}
	if code := outsider.do(http.MethodPut, itemPath+"/kudos", "", nil); code != http.StatusNotFound {
		t.Fatalf("outsider thanking: %d", code)
	}
	for i := 0; i < 2; i++ {
		if code := bia.do(http.MethodPut, itemPath+"/kudos", "", nil); code != http.StatusNoContent {
			t.Fatalf("thanking: %d", code)
		}
	}
	var engagement struct {
		KudosCount   int
		KudosMine    bool
		FocusMinutes int
	}
	if code := bia.do(http.MethodGet, itemPath+"/engagement", "", &engagement); code != http.StatusOK || engagement.KudosCount != 1 || !engagement.KudosMine {
		t.Fatalf("engagement: %d %+v", code, engagement)
	}
	if code := outsider.do(http.MethodGet, itemPath+"/engagement", "", nil); code != http.StatusNotFound {
		t.Fatalf("outsider engagement: %d", code)
	}
	var notes []struct{ Kind string }
	ana.do(http.MethodGet, "/api/v1/notifications", "", &notes)
	thanked := 0
	for _, note := range notes {
		if note.Kind == "kudos" {
			thanked++
		}
	}
	if thanked != 1 {
		t.Fatalf("the assignee hears about the thanks exactly once: %+v", notes)
	}
	if s := stats(ana); s.KudosReceived != 1 {
		t.Fatalf("kudos received: %+v", s)
	}
	if s := stats(bia); s.KudosGiven != 1 {
		t.Fatalf("kudos given: %+v", s)
	}
	if code := bia.do(http.MethodDelete, itemPath+"/kudos", "", nil); code != http.StatusNoContent {
		t.Fatalf("taking the thanks back: %d", code)
	}
	bia.do(http.MethodGet, itemPath+"/engagement", "", &engagement)
	if engagement.KudosCount != 0 || engagement.KudosMine {
		t.Fatalf("after removing: %+v", engagement)
	}

	// Focus time: whole minutes between 1 and 180, on an activity you can read.
	for _, minutes := range []int{0, -5, 181} {
		if code := ana.do(http.MethodPost, itemPath+"/focus", fmt.Sprintf(`{"minutes":%d}`, minutes), nil); code != http.StatusBadRequest {
			t.Fatalf("focus of %d minutes: %d", minutes, code)
		}
	}
	if code := outsider.do(http.MethodPost, itemPath+"/focus", `{"minutes":25}`, nil); code != http.StatusNotFound {
		t.Fatalf("outsider focus: %d", code)
	}
	if code := ana.do(http.MethodPost, itemPath+"/focus", `{"minutes":25}`, nil); code != http.StatusNoContent {
		t.Fatalf("focus: %d", code)
	}
	if s := stats(ana); s.FocusMinutes != 25 {
		t.Fatalf("focus minutes: %+v", s)
	}
	ana.do(http.MethodGet, itemPath+"/engagement", "", &engagement)
	if engagement.FocusMinutes != 25 {
		t.Fatalf("item focus minutes: %+v", engagement)
	}
}
