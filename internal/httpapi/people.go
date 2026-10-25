package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// ListSessions shows the caller's own sessions, so a forgotten browser can be ended.
func (h *healthHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := sqlc.New(h.auth.pool).ListAccountSessions(ctx, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
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

func (h *healthHandler) RevokeSession(w http.ResponseWriter, r *http.Request, sessionId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	revoked, err := sqlc.New(h.auth.pool).RevokeAccountSession(ctx, sqlc.RevokeAccountSessionParams{ID: pgUUID(uuidFrom(sessionId)), AccountID: session.AccountID})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if revoked == 0 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if pgUUID(uuidFrom(sessionId)) == session.ID {
		clearAuthCookies(w)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *healthHandler) ListOrganizationPeople(w http.ResponseWriter, r *http.Request) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	rows, err := q.ListOrganizationPeople(ctx, membership.OrganizationID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
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
func (h *healthHandler) SetPersonActive(w http.ResponseWriter, r *http.Request, accountId openapi_types.UUID) {
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
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	membership, err := q.GetOrganizationMembershipForAccount(ctx, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	target := pgUUID(uuidFrom(accountId))
	person, err := q.GetOrganizationPerson(ctx, sqlc.GetOrganizationPersonParams{OrganizationID: membership.OrganizationID, ID: target})
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if !payload.Active && person.IsAdmin && person.Active {
		admins, countErr := q.CountActiveAdmins(ctx, membership.OrganizationID)
		if countErr != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if admins <= 1 {
			w.WriteHeader(http.StatusConflict)
			return
		}
	}
	err = q.SetAccountActive(ctx, sqlc.SetAccountActiveParams{ID: target, Active: payload.Active})
	if err == nil && !payload.Active {
		_, err = q.RevokeAllAccountSessions(ctx, target)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
