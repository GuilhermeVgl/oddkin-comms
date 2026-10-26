package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// ListSessions shows the caller's own sessions, so a forgotten browser can be ended.
func (h *apiServer) ListSessions(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := sqlc.New(h.auth.pool).ListAccountSessions(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	sessions := make([]gen.AuthSession, 0, len(rows))
	for _, row := range rows {
		sessions = append(sessions, gen.AuthSession{
			Id: fromPG(row.ID), CreatedAt: row.CreatedAt.Time, LastSeenAt: row.LastSeenAt.Time, ExpiresAt: row.ExpiresAt.Time,
			Current: row.ID == session.ID,
		})
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (h *apiServer) RevokeSession(w http.ResponseWriter, r *http.Request, sessionId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	revoked, err := sqlc.New(h.auth.pool).RevokeAccountSession(ctx, sqlc.RevokeAccountSessionParams{ID: toPG(sessionId), AccountID: session.AccountID})
	if err != nil {
		serverError(w, r, err)
		return
	}
	if revoked == 0 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if toPG(sessionId) == session.ID {
		clearAuthCookies(w)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiServer) ListOrganizationPeople(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	membership, err := q.GetOrganizationMembershipForAccount(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	rows, err := q.ListOrganizationPeople(ctx, membership.OrganizationID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	people := make([]gen.OrganizationPerson, 0, len(rows))
	for _, row := range rows {
		people = append(people, gen.OrganizationPerson{
			Id: fromPG(row.ID), Email: openapi_types.Email(row.EmailNormalized), Active: row.Active,
			MembershipKind: gen.OrganizationPersonMembershipKind(row.MembershipKind), IsAdmin: row.IsAdmin,
		})
	}
	writeJSON(w, http.StatusOK, people)
}

// SetPersonActive ends all access of a deactivated account at once: its
// sessions are revoked in the same transaction.
func (h *apiServer) SetPersonActive(w http.ResponseWriter, r *http.Request, accountId openapi_types.UUID) {
	var payload gen.SetActiveRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		membership, err := q.GetOrganizationMembershipForAccount(ctx, session.AccountID)
		if err != nil {
			return err
		}
		target := toPG(accountId)
		person, err := q.GetOrganizationPerson(ctx, sqlc.GetOrganizationPersonParams{OrganizationID: membership.OrganizationID, ID: target})
		if err != nil {
			return statusError(http.StatusNotFound)
		}
		if !payload.Active && person.IsAdmin && person.Active {
			admins, countErr := q.CountActiveAdmins(ctx, membership.OrganizationID)
			if countErr != nil {
				return countErr
			}
			if admins <= 1 {
				return statusError(http.StatusConflict)
			}
		}
		if err = q.SetAccountActive(ctx, sqlc.SetAccountActiveParams{ID: target, Active: payload.Active}); err != nil {
			return err
		}
		if !payload.Active {
			_, err = q.RevokeAllAccountSessions(ctx, target)
		}
		return err
	})
	if respondError(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SetHistoryMode lets a person choose whether they are asked to set up access
// to encrypted history. "auto" is only ever set by an invitation.
func (h *apiServer) SetHistoryMode(w http.ResponseWriter, r *http.Request) {
	var payload gen.SetHistoryModeRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if payload.Mode != gen.Ask && payload.Mode != gen.None {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := sqlc.New(h.auth.pool).SetHistoryMode(ctx, sqlc.SetHistoryModeParams{AccountID: session.AccountID, HistoryMode: string(payload.Mode)}); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
