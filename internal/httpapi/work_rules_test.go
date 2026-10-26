package httpapi

import (
	"errors"
	"net/http"
	"testing"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func statusOf(t *testing.T, err error) int {
	t.Helper()
	var status statusError
	if !errors.As(err, &status) {
		t.Fatalf("want a statusError, got %v", err)
	}
	return int(status)
}

func TestAuthorizeWorkItemUpdate(t *testing.T) {
	item := sqlc.WorkItem{Version: 3}
	edit := true
	title := "new"
	column := openapi_types.UUID{1}
	internal := projectAccess{access: work.Access{Kind: "internal"}}
	readOnly := projectAccess{access: work.Access{Kind: "external", External: []string{work.WorkRead}}}

	cases := map[string]struct {
		access  projectAccess
		payload gen.UpdateWorkItemRequest
		want    int
	}{
		"internal member edits":                {internal, gen.UpdateWorkItemRequest{Version: 3, Title: &title}, 0},
		"read-only external cannot edit":       {readOnly, gen.UpdateWorkItemRequest{Version: 3, Title: &title}, http.StatusForbidden},
		"read-only external cannot move":       {readOnly, gen.UpdateWorkItemRequest{Version: 3, ColumnId: &column}, http.StatusForbidden},
		"clearing the assignee counts as edit": {readOnly, gen.UpdateWorkItemRequest{Version: 3, ClearAssignee: &edit}, http.StatusForbidden},
		"stale version conflicts":              {internal, gen.UpdateWorkItemRequest{Version: 2, Title: &title}, http.StatusConflict},
		"archived project conflicts":           {projectAccess{access: internal.access, archived: true}, gen.UpdateWorkItemRequest{Version: 3, Title: &title}, http.StatusConflict},
		"forbidden wins over a stale version":  {readOnly, gen.UpdateWorkItemRequest{Version: 2, Title: &title}, http.StatusForbidden},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			err := authorizeWorkItemUpdate(tc.access, item, tc.payload)
			if tc.want == 0 {
				if err != nil {
					t.Fatalf("want allowed, got %v", err)
				}
				return
			}
			if got := statusOf(t, err); got != tc.want {
				t.Fatalf("status = %d, want %d", got, tc.want)
			}
		})
	}
}

func uuidOf(b byte) pgtype.UUID { return pgtype.UUID{Bytes: [16]byte{b}, Valid: true} }

func TestCheckCloseDecisions(t *testing.T) {
	finished := sqlc.ListSprintTasksForCloseRow{ID: uuidOf(1), Finished: true}
	open := sqlc.ListSprintTasksForCloseRow{ID: uuidOf(2), Version: 5, Accessible: true}
	hidden := sqlc.ListSprintTasksForCloseRow{ID: uuidOf(3), Version: 1}

	cases := map[string]struct {
		tasks     []sqlc.ListSprintTasksForCloseRow
		decisions map[pgtype.UUID]closeDecision
		wantNext  bool
		wantCode  int
	}{
		"nothing pending":          {[]sqlc.ListSprintTasksForCloseRow{finished}, nil, false, 0},
		"backlog decision":         {[]sqlc.ListSprintTasksForCloseRow{finished, open}, map[pgtype.UUID]closeDecision{open.ID: {5, "backlog"}}, false, 0},
		"carried to next":          {[]sqlc.ListSprintTasksForCloseRow{open}, map[pgtype.UUID]closeDecision{open.ID: {5, "next"}}, true, 0},
		"missing decision":         {[]sqlc.ListSprintTasksForCloseRow{open}, nil, false, http.StatusBadRequest},
		"stale version":            {[]sqlc.ListSprintTasksForCloseRow{open}, map[pgtype.UUID]closeDecision{open.ID: {4, "next"}}, false, http.StatusConflict},
		"task hidden from admin":   {[]sqlc.ListSprintTasksForCloseRow{hidden}, map[pgtype.UUID]closeDecision{hidden.ID: {1, "next"}}, false, http.StatusConflict},
		"decision for finished":    {[]sqlc.ListSprintTasksForCloseRow{finished, open}, map[pgtype.UUID]closeDecision{open.ID: {5, "next"}, finished.ID: {1, "next"}}, false, http.StatusBadRequest},
		"decision for unknown one": {[]sqlc.ListSprintTasksForCloseRow{open}, map[pgtype.UUID]closeDecision{open.ID: {5, "next"}, uuidOf(9): {1, "next"}}, false, http.StatusBadRequest},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			next, err := checkCloseDecisions(tc.tasks, tc.decisions)
			if tc.wantCode == 0 {
				if err != nil || next != tc.wantNext {
					t.Fatalf("got next=%v err=%v, want next=%v", next, err, tc.wantNext)
				}
				return
			}
			if got := statusOf(t, err); got != tc.wantCode {
				t.Fatalf("status = %d, want %d", got, tc.wantCode)
			}
		})
	}
}
