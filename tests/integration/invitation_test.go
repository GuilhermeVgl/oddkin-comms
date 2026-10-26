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
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestOrganizationInvitationIsSingleUseAndTimeBound(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("configure test pool:", err)
	}
	defer pool.Close()
	const organizationID = "20000000-0000-4000-8000-000000000001"
	var orgID pgtype.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ($1, 'UTC') RETURNING id`, organizationID).Scan(&orgID); err != nil {
		t.Fatal("create test organization:", err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID); err != nil {
			t.Error("delete test organization:", err)
		}
	}()
	queries := sqlc.New(pool)
	now := time.Now().UTC()
	email, err := identity.NormalizeEmail(" Person@Example.TEST ")
	if err != nil {
		t.Fatal("normalize recipient email:", err)
	}
	_, validRecord, err := identity.IssueInvitationToken(now)
	if err != nil {
		t.Fatal("issue test token:", err)
	}
	valid, err := queries.CreateOrganizationInvitation(ctx, sqlc.CreateOrganizationInvitationParams{
		OrganizationID:  orgID,
		EmailNormalized: email,
		MembershipKind:  "external",
		TokenHash:       validRecord.Hash[:],
		ExpiresAt:       pgtype.Timestamptz{Time: validRecord.ExpiresAt, Valid: true},
	})
	if err != nil {
		t.Fatal("create invitation:", err)
	}
	if valid.EmailNormalized != "person@example.test" || valid.MembershipKind != "external" {
		t.Fatalf("stored invitation differs from request: %+v", valid)
	}
	_, err = queries.ClaimOrganizationInvitation(ctx, sqlc.ClaimOrganizationInvitationParams{
		TokenHash: validRecord.Hash[:], EmailNormalized: "other@example.test",
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("a different email must not claim the invitation, got %v", err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			_, claimErr := queries.ClaimOrganizationInvitation(ctx, sqlc.ClaimOrganizationInvitationParams{
				TokenHash: validRecord.Hash[:], EmailNormalized: email,
			})
			results <- claimErr
		}()
	}
	close(start)
	successes, alreadyUsed := 0, 0
	for range 2 {
		select {
		case claimErr := <-results:
			switch {
			case claimErr == nil:
				successes++
			case errors.Is(claimErr, pgx.ErrNoRows):
				alreadyUsed++
			default:
				t.Errorf("claim failed unexpectedly: %v", claimErr)
			}
		case <-ctx.Done():
			t.Fatal("concurrent claim did not finish:", ctx.Err())
		}
	}
	if successes != 1 || alreadyUsed != 1 {
		t.Errorf("concurrent claims: successes=%d alreadyUsed=%d; want 1 each", successes, alreadyUsed)
	}

	_, expiredRecord, err := identity.IssueInvitationToken(now.Add(-8 * 24 * time.Hour))
	if err != nil {
		t.Fatal("issue expired test token:", err)
	}
	_, err = queries.CreateOrganizationInvitation(ctx, sqlc.CreateOrganizationInvitationParams{
		OrganizationID:  orgID,
		EmailNormalized: "expired@example.test",
		MembershipKind:  "internal",
		TokenHash:       expiredRecord.Hash[:],
		ExpiresAt:       pgtype.Timestamptz{Time: expiredRecord.ExpiresAt, Valid: true},
	})
	if err != nil {
		t.Fatal("create expired invitation:", err)
	}
	_, err = queries.ClaimOrganizationInvitation(ctx, sqlc.ClaimOrganizationInvitationParams{
		TokenHash: expiredRecord.Hash[:], EmailNormalized: "expired@example.test",
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("expired invitation must not be claimed, got %v", err)
	}

	_, invalidRecord, err := identity.IssueInvitationToken(now)
	if err != nil {
		t.Fatal("issue invalid-email test token:", err)
	}
	_, err = queries.CreateOrganizationInvitation(ctx, sqlc.CreateOrganizationInvitationParams{
		OrganizationID:  orgID,
		EmailNormalized: "Person@Example.test",
		MembershipKind:  "external",
		TokenHash:       invalidRecord.Hash[:],
		ExpiresAt:       pgtype.Timestamptz{Time: now.Add(time.Hour), Valid: true},
	})
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		t.Errorf("non-normalized email should violate check constraint, got %v", err)
	}
	for _, invalid := range []struct {
		name string
		kind string
		hash []byte
	}{
		{name: "invalid membership", kind: "administrator", hash: invalidRecord.Hash[:]},
		{name: "short token hash", kind: "internal", hash: []byte{1}},
	} {
		t.Run(invalid.name, func(t *testing.T) {
			_, err := queries.CreateOrganizationInvitation(ctx, sqlc.CreateOrganizationInvitationParams{
				OrganizationID:  orgID,
				EmailNormalized: "valid@example.test",
				MembershipKind:  invalid.kind,
				TokenHash:       invalid.hash,
				ExpiresAt:       pgtype.Timestamptz{Time: now.Add(time.Hour), Valid: true},
			})
			var constraintErr *pgconn.PgError
			if !errors.As(err, &constraintErr) || constraintErr.Code != "23514" {
				t.Errorf("%s should violate check constraint, got %v", invalid.name, err)
			}
		})
	}
}
