package migration

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/db/migrations"
	"github.com/GuilhermeVgl/oddkin-comms/internal/installation"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
)

const advisoryLockID int64 = 0x4f44444b494e

// Admin is the first administrator, created once on an empty installation.
type Admin struct {
	Email, Password, Timezone string
}

// AdminFromEnv reads ODDKIN_ADMIN_EMAIL, ODDKIN_ADMIN_PASSWORD and
// ODDKIN_TIMEZONE. It returns nil when no administrator is configured and an
// error when only one of e-mail and password is.
func AdminFromEnv() (*Admin, error) {
	email, password := os.Getenv("ODDKIN_ADMIN_EMAIL"), os.Getenv("ODDKIN_ADMIN_PASSWORD")
	if email == "" && password == "" {
		return nil, nil
	}
	if email == "" || password == "" {
		return nil, errors.New("ODDKIN_ADMIN_EMAIL and ODDKIN_ADMIN_PASSWORD are required together")
	}
	timezone := os.Getenv("ODDKIN_TIMEZONE")
	if timezone == "" {
		timezone = "UTC"
	}
	return &Admin{Email: email, Password: password, Timezone: timezone}, nil
}

// Run applies the migrations only.
func Run(ctx context.Context, databaseURL string) error {
	return RunWithAdmin(ctx, databaseURL, nil)
}

// RunWithAdmin applies application migrations before River migrations under one
// installation-wide advisory lock, so concurrent starts cannot migrate twice,
// and then creates the first administrator when one is given and the
// installation is still empty (a later run changes nothing). The API calls it at
// startup unless AUTO_MIGRATE=false; cmd/migrate is the same call by hand.
func RunWithAdmin(ctx context.Context, databaseURL string, admin *Admin) (err error) {
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
	if admin != nil {
		switch err := installation.Bootstrap(ctx, pool, admin.Email, admin.Password, admin.Timezone); {
		case err == nil, errors.Is(err, installation.ErrAlreadyInitialized):
		default:
			return fmt.Errorf("create the first administrator: %w", err)
		}
	}
	return nil
}
