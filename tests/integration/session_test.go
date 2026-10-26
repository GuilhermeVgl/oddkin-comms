//go:build integration

package integration

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSessionExpiresByInactivityAndCanBeRevoked(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	queries := sqlc.New(pool)
	passwordHash, err := identity.HashPassword("another long password")
	if err != nil {
		t.Fatal(err)
	}
	account, err := queries.CreateAccount(ctx, sqlc.CreateAccountParams{
		EmailNormalized: "session@example.test", PasswordHash: passwordHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	var organizationID pgtype.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ('73000000-0000-4000-8000-000000000001', 'UTC') RETURNING id`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := queries.CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{
		OrganizationID: organizationID, AccountID: account.ID, MembershipKind: "internal", IsAdmin: false,
	}); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID); err != nil {
			t.Error(err)
		}
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM account WHERE id = $1`, account.ID); err != nil {
			t.Error(err)
		}
	}()
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
