package httpapi

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func TestChooseInvitees(t *testing.T) {
	self, other, third := pgUUID(uuid.New()), pgUUID(uuid.New()), pgUUID(uuid.New())
	eligible := []pgtype.UUID{self, other, third}
	list := func(ids ...pgtype.UUID) *[]openapi_types.UUID {
		out := make([]openapi_types.UUID, len(ids))
		for i, id := range ids {
			out[i] = fromPG(id)
		}
		return &out
	}
	cases := []struct {
		name      string
		requested *[]openapi_types.UUID
		eligible  []pgtype.UUID
		kind      string
		want      []pgtype.UUID
		valid     bool
	}{
		{"channel without list rings nobody", nil, eligible, "channel", nil, true},
		{"channel with list", list(other, third), eligible, "channel", []pgtype.UUID{other, third}, true},
		{"dm without list rings the other person", nil, []pgtype.UUID{self, other}, "dm", []pgtype.UUID{other}, true},
		{"dm with an empty list rings the other person", list(), []pgtype.UUID{self, other}, "dm", []pgtype.UUID{other}, true},
		{"caller cannot invite themselves", list(self), eligible, "channel", nil, false},
		{"stranger is refused", list(pgUUID(uuid.New())), eligible, "channel", nil, false},
		{"same person twice is refused", list(other, other), eligible, "channel", nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, valid := chooseInvitees(c.requested, c.eligible, self, c.kind)
			if valid != c.valid {
				t.Fatalf("valid = %v, want %v", valid, c.valid)
			}
			if c.valid && !equalIDs(got, c.want) {
				t.Fatalf("invitees = %v, want %v", got, c.want)
			}
		})
	}
}

func equalIDs(a, b []pgtype.UUID) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestCheckEnvelopeRecipients(t *testing.T) {
	first, second, stranger := pgUUID(uuid.New()), pgUUID(uuid.New()), pgUUID(uuid.New())
	required := []pgtype.UUID{first, second}
	cases := []struct {
		name  string
		items []grantItem
		want  int
	}{
		{"exact set", []grantItem{{recipient: second}, {recipient: first}}, 0},
		{"missing a recipient", []grantItem{{recipient: first}}, http.StatusConflict},
		{"envelope for someone who must not hold the key", []grantItem{{recipient: first}, {recipient: stranger}}, http.StatusBadRequest},
		{"two envelopes for one device", []grantItem{{recipient: first}, {recipient: first}}, http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := checkEnvelopeRecipients(c.items, required)
			var status statusError
			switch {
			case c.want == 0 && err != nil:
				t.Fatalf("unexpected error: %v", err)
			case c.want != 0 && (!errors.As(err, &status) || int(status) != c.want):
				t.Fatalf("error = %v, want status %d", err, c.want)
			}
		})
	}
}

func TestRespondCallErrorWritesTheConflictBody(t *testing.T) {
	recorder := httptest.NewRecorder()
	if !respondCallError(recorder, httptest.NewRequest(http.MethodPost, "/", nil), callConflict(gen.CallFull)) {
		t.Fatal("a conflict must end the request")
	}
	if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), string(gen.CallFull)) {
		t.Fatalf("got %d %q", recorder.Code, recorder.Body.String())
	}
	if respondCallError(recorder, httptest.NewRequest(http.MethodPost, "/", nil), nil) {
		t.Fatal("no error must not end the request")
	}
}
