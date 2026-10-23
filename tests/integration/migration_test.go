//go:build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/platform/migration"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMigrationsCanRunTwiceAndInstallRiver(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := migration.Run(ctx, dsn); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("could not configure test database pool")
	}
	defer pool.Close()
	for _, table := range []string{"organization", "river_job", "goose_db_version"} {
		var exists bool
		err := pool.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, "public."+table).Scan(&exists)
		if err != nil || !exists {
			t.Errorf("expected migrated table %s: exists=%t error=%v", table, exists, err)
		}
	}
}
