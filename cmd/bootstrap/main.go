package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/GuilhermeVgl/oddkin-comms/internal/installation"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		if errors.Is(err, installation.ErrAlreadyInitialized) {
			logger.Info("installation already initialized")
			return
		}
		logger.Error("installation bootstrap failed", "error", err)
		os.Exit(1)
	}
	logger.Info("installation bootstrap completed")
}

func run(ctx context.Context) error {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	email := os.Getenv("ODDKIN_ADMIN_EMAIL")
	if email == "" {
		return errors.New("ODDKIN_ADMIN_EMAIL is required")
	}
	password := os.Getenv("ODDKIN_ADMIN_PASSWORD")
	if password == "" {
		return errors.New("ODDKIN_ADMIN_PASSWORD is required")
	}
	timezone := os.Getenv("ODDKIN_TIMEZONE")
	if timezone == "" {
		timezone = "UTC"
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return errors.New("DATABASE_URL is invalid")
	}
	defer pool.Close()
	return installation.Bootstrap(ctx, pool, email, password, timezone)
}
