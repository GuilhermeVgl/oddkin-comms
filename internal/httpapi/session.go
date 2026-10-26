package httpapi

import (
	"net/http"

	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
)

// reader authenticates a read request.
func (h *server) reader(w http.ResponseWriter, r *http.Request) (sqlc.FindActiveSessionByTokenHashRow, bool) {
	session, status := h.activeSession(r)
	if status != http.StatusOK {
		w.WriteHeader(status)
		return session, false
	}
	return session, true
}

// mutator authenticates a state-changing request: origin, session and CSRF.
func (h *server) mutator(w http.ResponseWriter, r *http.Request) (sqlc.FindActiveSessionByTokenHashRow, bool) {
	if !sameOrigin(r) {
		w.WriteHeader(http.StatusForbidden)
		return sqlc.FindActiveSessionByTokenHashRow{}, false
	}
	session, ok := h.reader(w, r)
	if !ok {
		return session, false
	}
	if !identity.VerifyCSRFToken(r.Header.Get("X-CSRF-Token"), session.CsrfHash) {
		w.WriteHeader(http.StatusForbidden)
		return session, false
	}
	return session, true
}
