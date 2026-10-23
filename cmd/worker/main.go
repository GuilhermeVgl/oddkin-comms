package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/jobs"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		logger.Error("worker stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return errors.New("DATABASE_URL is invalid")
	}
	defer pool.Close()
	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Queues:          map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: 4}},
		Workers:         jobs.NewWorkers(pool),
		SoftStopTimeout: 30 * time.Second,
	})
	if err != nil {
		return err
	}
	if err := client.Start(ctx); err != nil {
		return errors.New("could not start River worker")
	}
	<-client.Stopped()
	return nil
}
