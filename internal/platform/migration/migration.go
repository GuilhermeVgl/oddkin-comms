package migration

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/db/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
)

const advisoryLockID int64 = 0x4f44444b494e

// Run applies application migrations before River migrations under one
// installation-wide advisory lock. It does not run during API or worker startup.
func Run(ctx context.Context, databaseURL string) (err error) {
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	lockConn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return errors.New("could not connect to migration database")
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if closeErr := lockConn.Close(closeCtx); err == nil && closeErr != nil {
			err = fmt.Errorf("close migration connection: %w", closeErr)
		}
	}()
	if _, err := lockConn.Exec(ctx, "SELECT pg_advisory_lock($1)", advisoryLockID); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return errors.New("invalid migration database configuration")
	}
	defer pool.Close()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() {
		if closeErr := sqlDB.Close(); err == nil && closeErr != nil {
			err = fmt.Errorf("close migration SQL adapter: %w", closeErr)
		}
	}()

	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.FS)
	if err != nil {
		return fmt.Errorf("configure application migrations: %w", err)
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("apply application migrations: %w", err)
	}
	migrator, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		return fmt.Errorf("configure River migrations: %w", err)
	}
	if _, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return fmt.Errorf("apply River migrations: %w", err)
	}
	return nil
}
