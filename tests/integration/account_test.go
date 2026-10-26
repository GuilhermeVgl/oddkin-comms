//go:build integration

package integration

import (
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestAccountRegistrationKeepsInvitationAtomic(t *testing.T) {
	ctx, pool := openTestPool(t, 20*time.Second)
	const email = "member@example.test"
	typedOrgID := newTestOrganization(t, ctx, pool, "40000000-0000-4000-8000-000000000001", "UTC")
	token, record, err := identity.IssueInvitationToken(time.Now())
	if err != nil || token == "" {
		t.Fatalf("issue invitation: %v", err)
	}
	if _, err := sqlc.New(pool).CreateOrganizationInvitation(ctx, sqlc.CreateOrganizationInvitationParams{
		OrganizationID: typedOrgID, EmailNormalized: email, MembershipKind: "internal",
		TokenHash: record.Hash[:], ExpiresAt: pgtype.Timestamptz{Time: record.ExpiresAt, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	hash := testPasswordHash(t, "sufficiently long password")
	register := func(commit bool) error {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback(ctx) }()
		if _, err := sqlc.New(tx).ClaimOrganizationInvitation(ctx, sqlc.ClaimOrganizationInvitationParams{
			TokenHash: record.Hash[:], EmailNormalized: email,
		}); err != nil {
			return err
		}
		queries := sqlc.New(tx)
		account, err := queries.CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: email, PasswordHash: hash})
		if err != nil {
			return err
		}
		if _, err := queries.CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{
			OrganizationID: typedOrgID, AccountID: account.ID, MembershipKind: "internal", IsAdmin: false,
		}); err != nil {
			return err
		}
		if !commit {
			return nil
		}
		return tx.Commit(ctx)
	}
	if err := register(false); err != nil {
		t.Fatal("registration before rollback:", err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM account WHERE email_normalized = $1`, email).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rolled back account still exists: count=%d err=%v", count, err)
	}
	if err := register(true); err != nil {
		t.Fatal("registration after rollback:", err)
	}
	if err := register(true); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("used invitation must not register again: %v", err)
	}
	var membershipKind string
	if err := pool.QueryRow(ctx, `SELECT membership_kind FROM organization_membership JOIN account ON account.id = organization_membership.account_id WHERE account.email_normalized = $1`, email).Scan(&membershipKind); err != nil || membershipKind != "internal" {
		t.Fatalf("registration did not persist membership: kind=%q err=%v", membershipKind, err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO account (email_normalized, password_hash) VALUES ($1, $2)`, email, hash)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("duplicate normalized email must fail: %v", err)
	}
	account, err := sqlc.New(pool).GetAccountByEmail(ctx, email)
	if err != nil || !identity.VerifyPassword("sufficiently long password", account.PasswordHash) {
		t.Fatalf("stored account password is not verifiable: %v", err)
	}
	tokenHash := sha256.Sum256([]byte("synthetic session token"))
	csrfHash := sha256.Sum256([]byte("synthetic csrf token"))
	_, err = pool.Exec(ctx, `INSERT INTO auth_session (account_id, token_hash, csrf_hash, expires_at) VALUES ($1, $2, $3, $4)`,
		account.ID, tokenHash[:], csrfHash[:], time.Now().Add(7*24*time.Hour))
	if err != nil {
		t.Fatal("create session:", err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO auth_session (account_id, token_hash, csrf_hash, expires_at) VALUES ($1, $2, $3, $4)`,
		account.ID, tokenHash[:], csrfHash[:], time.Now().Add(7*24*time.Hour))
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("duplicate session token must fail: %v", err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO auth_session (account_id, token_hash, csrf_hash, expires_at) VALUES ($1, $2, $3, $4)`,
		account.ID, []byte{1}, csrfHash[:], time.Now().Add(7*24*time.Hour))
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		t.Fatalf("short session token hash must fail: %v", err)
	}
}
