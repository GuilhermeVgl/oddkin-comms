//go:build integration

package integration

import (
	"errors"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestSessionExpiresByInactivityAndCanBeRevoked(t *testing.T) {
	ctx, pool := openTestPool(t, 20*time.Second)
	queries := sqlc.New(pool)
	const email = "session@example.test"
	organizationID := newTestOrganization(t, ctx, pool, "73000000-0000-4000-8000-000000000001", "UTC", email)
	createTestAccount(t, ctx, queries, organizationID, email, "another long password", "internal", false)
	account, err := queries.GetAccountByEmail(ctx, email)
	if err != nil {
		t.Fatal(err)
	}
	issued, err := identity.IssueSession(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	session, err := queries.CreateAuthSession(ctx, sqlc.CreateAuthSessionParams{
		AccountID: account.ID, TokenHash: issued.TokenHash[:], CsrfHash: issued.CSRFHash[:],
		ExpiresAt: pgtype.Timestamptz{Time: issued.ExpiresAt, Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	active, err := queries.FindActiveSessionByTokenHash(ctx, issued.TokenHash[:])
	if err != nil || active.ID != session.ID || !identity.VerifyCSRFToken(issued.CSRFToken, active.CsrfHash) {
		t.Fatalf("new session cannot authenticate: row=%+v err=%v", active, err)
	}
	wrong, ok := identity.HashSessionToken(issued.CSRFToken)
	if !ok {
		t.Fatal("issued CSRF token is malformed")
	}
	if _, err := queries.FindActiveSessionByTokenHash(ctx, wrong[:]); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("CSRF token must not authenticate as a session: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE auth_session SET last_seen_at = clock_timestamp() - interval '25 hours' WHERE id = $1`, session.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := queries.FindActiveSessionByTokenHash(ctx, issued.TokenHash[:]); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("inactive session must expire: %v", err)
	}
	if changed, err := queries.TouchAuthSession(ctx, session.ID); err != nil || changed != 0 {
		t.Fatalf("inactive session must not be revived: changed=%d err=%v", changed, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE auth_session SET last_seen_at = clock_timestamp() WHERE id = $1`, session.ID); err != nil {
		t.Fatal(err)
	}
	if revoked, err := queries.RevokeAuthSession(ctx, session.ID); err != nil || revoked != 1 {
		t.Fatalf("revoke session: revoked=%d err=%v", revoked, err)
	}
	if _, err := queries.FindActiveSessionByTokenHash(ctx, issued.TokenHash[:]); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("revoked session must not authenticate: %v", err)
	}
	if revoked, err := queries.RevokeAuthSession(ctx, session.ID); err != nil || revoked != 0 {
		t.Fatalf("repeated revocation must be idempotent: revoked=%d err=%v", revoked, err)
	}
	second, err := identity.IssueSession(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	other, err := queries.CreateAuthSession(ctx, sqlc.CreateAuthSessionParams{
		AccountID: account.ID, TokenHash: second.TokenHash[:], CsrfHash: second.CSRFHash[:],
		ExpiresAt: pgtype.Timestamptz{Time: second.ExpiresAt, Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE auth_session SET created_at = clock_timestamp() - interval '8 days', expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`, other.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := queries.FindActiveSessionByTokenHash(ctx, second.TokenHash[:]); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("absolute session expiry must be enforced: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE auth_session SET expires_at = clock_timestamp() + interval '1 day' WHERE id = $1`, other.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE account SET active = false WHERE id = $1`, account.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := queries.FindActiveSessionByTokenHash(ctx, second.TokenHash[:]); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("inactive account must not authenticate: %v", err)
	}
	if revoked, err := queries.RevokeAllAccountSessions(ctx, account.ID); err != nil || revoked != 1 {
		t.Fatalf("global logout did not revoke remaining session: revoked=%d err=%v", revoked, err)
	}
}
