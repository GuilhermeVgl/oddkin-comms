//go:build integration

package integration

import (
	"context"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/db/migrations"
	"github.com/GuilhermeVgl/oddkin-comms/internal/platform/migration"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
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
	for _, table := range []string{"organization", "organization_invitation", "invitation_delivery", "account", "organization_membership", "auth_session", "project", "project_member", "external_project_policy", "board_column", "work_item", "work_item_comment", "river_job", "goose_db_version"} {
		var exists bool
		err := pool.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, "public."+table).Scan(&exists)
		if err != nil || !exists {
			t.Errorf("expected migrated table %s: exists=%t error=%v", table, exists, err)
		}
	}
}

func TestMigrationUpgradesExistingOrganizationDatabase(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	adminPool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("configure admin test pool:", err)
	}
	defer adminPool.Close()
	const databaseName = "oddkin_upgrade_test"
	if _, err := adminPool.Exec(ctx, `CREATE DATABASE oddkin_upgrade_test`); err != nil {
		t.Fatal("create upgrade test database:", err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := adminPool.Exec(cleanupCtx, `DROP DATABASE oddkin_upgrade_test WITH (FORCE)`); err != nil {
			t.Error("drop upgrade test database:", err)
		}
	}()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal("parse synthetic test DSN:", err)
	}
	parsed.Path = "/" + databaseName
	upgradeDSN := parsed.String()
	upgradePool, err := pgxpool.New(ctx, upgradeDSN)
	if err != nil {
		t.Fatal("configure upgrade test pool:", err)
	}
	defer upgradePool.Close()
	sqlDB := stdlib.OpenDBFromPool(upgradePool)
	defer func() {
		if err := sqlDB.Close(); err != nil {
			t.Error("close upgrade SQL adapter:", err)
		}
	}()
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.FS)
	if err != nil {
		t.Fatal("configure old-schema provider:", err)
	}
	if _, err := provider.UpTo(ctx, 1); err != nil {
		t.Fatal("apply original organization migration:", err)
	}
	const orgID = "30000000-0000-4000-8000-000000000001"
	if _, err := upgradePool.Exec(ctx, `INSERT INTO organization (id, timezone) VALUES ($1, $2)`, orgID, "America/Campo_Grande"); err != nil {
		t.Fatal("insert pre-upgrade organization:", err)
	}
	if err := migration.Run(ctx, upgradeDSN); err != nil {
		t.Fatal("upgrade application and River schemas:", err)
	}
	var timezone string
	if err := upgradePool.QueryRow(ctx, `SELECT timezone FROM organization WHERE id = $1`, orgID).Scan(&timezone); err != nil || timezone != "America/Campo_Grande" {
		t.Fatalf("existing organization changed after upgrade: timezone=%q err=%v", timezone, err)
	}
	for _, table := range []string{"organization_invitation", "invitation_delivery", "account", "organization_membership", "auth_session", "river_job"} {
		var exists bool
		if err := upgradePool.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, "public."+table).Scan(&exists); err != nil || !exists {
			t.Errorf("upgrade did not create %s: exists=%t err=%v", table, exists, err)
		}
	}
}
