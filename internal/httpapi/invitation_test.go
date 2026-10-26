package httpapi

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestPlanInvitation(t *testing.T) {
	auto, ask, bogus := gen.Auto, gen.Ask, gen.HistoryMode("bogus")
	extra, badExtra := "x=1&y=2", "no spaces allowed"
	external, internal := gen.CreateInvitationRequestMembershipKindExternal, gen.CreateInvitationRequestMembershipKindInternal

	cases := []struct {
		name      string
		orgAdmin  bool
		inProject bool
		payload   gen.CreateInvitationRequest
		wantMode  string
		wantCode  int
	}{
		{"admin defaults history to ask", true, false, gen.CreateInvitationRequest{MembershipKind: internal}, "ask", 0},
		{"admin may carry history", true, false, gen.CreateInvitationRequest{MembershipKind: internal, HistoryMode: &auto}, "auto", 0},
		{"unknown history mode", true, false, gen.CreateInvitationRequest{MembershipKind: internal, HistoryMode: &bogus}, "", http.StatusBadRequest},
		{"project member invites an external person", false, true, gen.CreateInvitationRequest{MembershipKind: external}, "ask", 0},
		{"project member explicitly asks", false, true, gen.CreateInvitationRequest{MembershipKind: external, HistoryMode: &ask}, "ask", 0},
		{"project member cannot invite an internal person", false, true, gen.CreateInvitationRequest{MembershipKind: internal}, "", http.StatusForbidden},
		{"invitation outside any project needs the administration", false, false, gen.CreateInvitationRequest{MembershipKind: external}, "", http.StatusForbidden},
		{"project member cannot carry history", false, true, gen.CreateInvitationRequest{MembershipKind: external, HistoryMode: &auto}, "", http.StatusBadRequest},
		{"link extra needs automatic history", true, false, gen.CreateInvitationRequest{MembershipKind: internal, LinkExtra: &extra}, "", http.StatusBadRequest},
		{"link extra with automatic history", true, false, gen.CreateInvitationRequest{MembershipKind: internal, HistoryMode: &auto, LinkExtra: &extra}, "auto", 0},
		{"link extra must be plain parameters", true, false, gen.CreateInvitationRequest{MembershipKind: internal, HistoryMode: &auto, LinkExtra: &badExtra}, "", http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			mode, err := planInvitation(c.orgAdmin, c.inProject, c.payload)
			if c.wantCode == 0 {
				if err != nil || mode != c.wantMode {
					t.Fatalf("planInvitation = %q, %v; want %q, nil", mode, err, c.wantMode)
				}
				return
			}
			var status statusError
			if !errors.As(err, &status) || int(status) != c.wantCode {
				t.Fatalf("planInvitation error = %v; want status %d", err, c.wantCode)
			}
		})
	}
}

func TestToInvitationStatus(t *testing.T) {
	now := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	future, past := now.Add(time.Hour), now.Add(-time.Hour)
	consumed := pgtype.Timestamptz{Time: past, Valid: true}

	cases := []struct {
		name string
		row  invitationRow
		want gen.InvitationStatusState
	}{
		{"waiting", invitationRow{ExpiresAt: future, Delivery: "sent"}, gen.InvitationStatusStatePending},
		{"accepted wins over expired", invitationRow{ExpiresAt: past, ConsumedAt: consumed}, gen.InvitationStatusStateAccepted},
		{"expired", invitationRow{ExpiresAt: past}, gen.InvitationStatusStateExpired},
		{"delivery failed", invitationRow{ExpiresAt: future, Delivery: "failed"}, gen.InvitationStatusStateFailed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := toInvitationStatus(c.row, now); got.State != c.want {
				t.Fatalf("state = %q, want %q", got.State, c.want)
			}
		})
	}
	accepted := toInvitationStatus(invitationRow{ExpiresAt: future, ConsumedAt: consumed}, now)
	if accepted.AcceptedAt == nil || !accepted.AcceptedAt.Equal(past) {
		t.Fatalf("acceptedAt = %v, want %v", accepted.AcceptedAt, past)
	}
}
