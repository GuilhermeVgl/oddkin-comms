//go:build integration

package integration

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/installation"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
)

func TestBootstrapCreatesOneAdministratorAtomically(t *testing.T) {
	ctx, pool := openTestPool(t, 20*time.Second)
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM organization`); err != nil {
			t.Error(err)
		}
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized IN ('admin@example.test', 'other@example.test')`); err != nil {
			t.Error(err)
		}
	}()
	if err := installation.Bootstrap(ctx, pool, "bad", "a long enough password", "UTC"); !errors.Is(err, identity.ErrInvalidEmail) {
		t.Fatalf("invalid admin email accepted: %v", err)
	}
	if err := installation.Bootstrap(ctx, pool, "admin@example.test", "short", "UTC"); !errors.Is(err, identity.ErrInvalidPassword) {
		t.Fatalf("invalid password accepted: %v", err)
	}
	if err := installation.Bootstrap(ctx, pool, "admin@example.test", "a long enough password", ""); !errors.Is(err, installation.ErrInvalidTimezone) {
		t.Fatalf("empty timezone accepted: %v", err)
	}
	if err := installation.Bootstrap(ctx, pool, "admin@example.test", "a long enough password", "Invalid/Zone"); err == nil {
		t.Fatal("invalid timezone accepted")
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM organization`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("invalid bootstrap left organization: count=%d err=%v", count, err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, email := range []string{"admin@example.test", "other@example.test"} {
		wg.Go(func() {
			results <- installation.Bootstrap(ctx, pool, email, "a long enough password", "America/Campo_Grande")
		})
	}
	wg.Wait()
	close(results)
	successes, already := 0, 0
	for result := range results {
		switch {
		case result == nil:
			successes++
		case errors.Is(result, installation.ErrAlreadyInitialized):
			already++
		default:
			t.Errorf("unexpected concurrent bootstrap result: %v", result)
		}
	}
	if successes != 1 || already != 1 {
		t.Fatalf("concurrent bootstrap: success=%d already=%d", successes, already)
	}
	var email, passwordHash, timezone, kind string
	var isAdmin bool
	err := pool.QueryRow(ctx, `SELECT a.email_normalized, a.password_hash, o.timezone, m.membership_kind, m.is_admin FROM organization AS o JOIN organization_membership AS m ON m.organization_id = o.id JOIN account AS a ON a.id = m.account_id`).Scan(&email, &passwordHash, &timezone, &kind, &isAdmin)
	if err != nil || timezone != "America/Campo_Grande" || kind != "internal" || !isAdmin || !identity.VerifyPassword("a long enough password", passwordHash) {
		t.Fatalf("administrator not installed correctly: email=%q timezone=%q kind=%q admin=%t err=%v", email, timezone, kind, isAdmin, err)
	}
	account, err := sqlc.New(pool).GetAccountByEmail(ctx, email)
	if err != nil || !account.Active {
		t.Fatalf("admin account inactive: %v", err)
	}
	if err := installation.Bootstrap(ctx, pool, "third@example.test", "a long enough password", "UTC"); !errors.Is(err, installation.ErrAlreadyInitialized) {
		t.Fatalf("second installation should fail: %v", err)
	}
}
