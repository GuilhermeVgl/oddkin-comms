//go:build integration

package integration

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestOnlyOneOrganizationPerInstallation(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("could not configure test database pool")
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal("begin organization test transaction:", err)
	}
	defer func() {
		if err := tx.Rollback(context.Background()); err != nil {
			t.Error("rollback organization test transaction:", err)
		}
	}()

	const insert = `INSERT INTO organization (id, timezone) VALUES ($1, $2)`
	if _, err := tx.Exec(ctx, insert, "10000000-0000-4000-8000-000000000001", "America/Campo_Grande"); err != nil {
		t.Fatalf("create first organization: %v", err)
	}
	_, err = tx.Exec(ctx, insert, "10000000-0000-4000-8000-000000000002", "UTC")
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("second organization should violate uniqueness, got %v", err)
	}
}
