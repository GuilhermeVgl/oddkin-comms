package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/calls"
	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/oddkin-comms/internal/identity"
	"github.com/GuilhermeVgl/oddkin-comms/internal/platform/objectstore"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

const sessionCookieName = "oddkin_session"
const csrfCookieName = "oddkin_csrf"

type authService struct {
	pool                  *pgxpool.Pool
	dummyHash             string
	limiter               *loginLimiter
	invitationDeliveryKey []byte
	jobs                  *river.Client[pgx.Tx]
	cursorKey             []byte
	store                 objectstore.Store
	quota                 int64
	livekit               calls.Config
	rooms                 calls.Rooms
}

func NewAppHandler(pool *pgxpool.Pool) (http.Handler, error) {
	return NewAppHandlerWithConfig(pool, AppConfig{})
}

type AppConfig struct {
	InvitationDeliveryKey []byte
	// EventCursorKey signs WebSocket resume cursors; when empty a random key
	// is generated, so cursors do not survive a restart (clients resync).
	EventCursorKey []byte
	// ObjectStore holds attachment bytes; nil disables uploads (503).
	ObjectStore objectstore.Store
	// AccessLog, when set, receives one line per request (see withObservability).
	AccessLog *slog.Logger
	// StorageQuotaBytes caps reserved attachment bytes per organization.
	StorageQuotaBytes int64
	// LiveKit enables calls; Rooms overrides the administrative client (tests).
	LiveKit calls.Config
	Rooms   calls.Rooms
}

func NewAppHandlerWithConfig(pool *pgxpool.Pool, config AppConfig) (http.Handler, error) {
	dummyHash, err := identity.HashPassword("synthetic unknown account password")
	if err != nil {
		return nil, err
	}
	cursorKey := append([]byte(nil), config.EventCursorKey...)
	if len(cursorKey) == 0 {
		cursorKey = make([]byte, 32)
		if _, err = rand.Read(cursorKey); err != nil {
			return nil, err
		}
	}
	rooms := config.Rooms
	if rooms == nil && config.LiveKit.APIKey != "" {
		var roomsErr error
		if rooms, roomsErr = calls.NewRooms(config.LiveKit); roomsErr != nil {
			return nil, roomsErr
		}
	}
	quota := config.StorageQuotaBytes
	if quota <= 0 {
		quota = defaultStorageQuota
	}
	jobClient, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		return nil, err
	}
	return withObservability(gen.Handler(&healthHandler{database: pool, auth: &authService{
		pool: pool, dummyHash: dummyHash, limiter: newLoginLimiter(),
		invitationDeliveryKey: append([]byte(nil), config.InvitationDeliveryKey...), jobs: jobClient, cursorKey: cursorKey, store: config.ObjectStore, quota: quota, livekit: config.LiveKit, rooms: rooms,
	}}), config.AccessLog), nil
}

func (h *healthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if !sameOrigin(r) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	var payload gen.LoginRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	email, err := identity.NormalizeEmail(string(payload.Email))
	ip := clientAddress(r.RemoteAddr)
	now := time.Now()
	if !h.auth.limiter.allow("ip:"+ip, 100, now) {
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	accountKey := "account:" + email
	if err == nil && !h.auth.limiter.allow(accountKey, 5, now) {
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	if err != nil || payload.Password == "" {
		h.auth.limiter.fail("ip:"+ip, 100, now)
		invalidCredentials(w)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	account, err := sqlc.New(h.auth.pool).GetAccountByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		identity.VerifyPassword(payload.Password, h.auth.dummyHash)
		h.auth.limiter.fail("ip:"+ip, 100, now)
		h.auth.limiter.fail(accountKey, 5, now)
		invalidCredentials(w)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if !identity.VerifyPassword(payload.Password, account.PasswordHash) || !account.Active {
		h.auth.limiter.fail("ip:"+ip, 100, now)
		h.auth.limiter.fail(accountKey, 5, now)
		invalidCredentials(w)
		return
	}
	issued, err := identity.IssueSession(time.Now())
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	_, err = sqlc.New(h.auth.pool).CreateAuthSession(ctx, sqlc.CreateAuthSessionParams{
		AccountID: account.ID, TokenHash: issued.TokenHash[:], CsrfHash: issued.CSRFHash[:],
		ExpiresAt: pgtype.Timestamptz{Time: issued.ExpiresAt, Valid: true},
	})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	h.auth.limiter.succeed(accountKey)
	w.Header().Set("Cache-Control", "no-store")
	setAuthCookies(w, issued)
	w.WriteHeader(http.StatusNoContent)
}

func (h *healthHandler) GetCurrentAccount(w http.ResponseWriter, r *http.Request) {
	session, status := h.activeSession(r)
	if status != http.StatusOK {
		w.WriteHeader(status)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	_, err := sqlc.New(h.auth.pool).TouchAuthSession(ctx, session.ID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	response := gen.CurrentAccount{
		Id:             openapi_types.UUID(uuid.UUID(session.AccountID.Bytes)),
		Email:          openapi_types.Email(session.EmailNormalized),
		MembershipKind: gen.CurrentAccountMembershipKind(session.MembershipKind),
		IsAdmin:        session.IsAdmin,
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if _, err := w.Write(encoded); err != nil {
		return
	}
}

func (h *healthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	h.revoke(w, r, false)
}

func (h *healthHandler) LogoutAll(w http.ResponseWriter, r *http.Request) {
	h.revoke(w, r, true)
}

func (h *healthHandler) revoke(w http.ResponseWriter, r *http.Request, all bool) {
	if !sameOrigin(r) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	session, status := h.activeSession(r)
	if status != http.StatusOK {
		w.WriteHeader(status)
		return
	}
	if !identity.VerifyCSRFToken(r.Header.Get("X-CSRF-Token"), session.CsrfHash) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	queries := sqlc.New(h.auth.pool)
	var err error
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if all {
		_, err = queries.RevokeAllAccountSessions(ctx, session.AccountID)
	} else {
		_, err = queries.RevokeAuthSession(ctx, session.ID)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	clearAuthCookies(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *healthHandler) activeSession(r *http.Request) (sqlc.FindActiveSessionByTokenHashRow, int) {
	if h.auth == nil {
		return sqlc.FindActiveSessionByTokenHashRow{}, http.StatusServiceUnavailable
	}
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return sqlc.FindActiveSessionByTokenHashRow{}, http.StatusUnauthorized
	}
	hash, ok := identity.HashSessionToken(cookie.Value)
	if !ok {
		return sqlc.FindActiveSessionByTokenHashRow{}, http.StatusUnauthorized
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	session, err := sqlc.New(h.auth.pool).FindActiveSessionByTokenHash(ctx, hash[:])
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.FindActiveSessionByTokenHashRow{}, http.StatusUnauthorized
	}
	if err != nil {
		return sqlc.FindActiveSessionByTokenHashRow{}, http.StatusServiceUnavailable
	}
	return session, http.StatusOK
}

func sameOrigin(r *http.Request) bool {
	raw := r.Header.Get("Origin")
	if raw == "" {
		return false
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return false
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return parsed.Scheme == scheme && parsed.Host == r.Host
}

func setAuthCookies(w http.ResponseWriter, issued identity.IssuedSession) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName, Value: issued.Token, Path: "/api/v1", Expires: issued.ExpiresAt,
		MaxAge: int(identity.SessionLifetime.Seconds()), Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name: csrfCookieName, Value: issued.CSRFToken, Path: "/", Expires: issued.ExpiresAt,
		MaxAge: int(identity.SessionLifetime.Seconds()), Secure: true, SameSite: http.SameSiteLaxMode,
	})
}

func clearAuthCookies(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookieName, Path: "/api/v1", MaxAge: -1, Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	http.SetCookie(w, &http.Cookie{Name: csrfCookieName, Path: "/", MaxAge: -1, Secure: true, SameSite: http.SameSiteLaxMode})
}

func invalidCredentials(w http.ResponseWriter) {
	http.Error(w, "invalid credentials", http.StatusUnauthorized)
}

func clientAddress(remote string) string {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		return remote
	}
	return host
}
