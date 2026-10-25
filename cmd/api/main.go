package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/calls"
	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi"
	"github.com/GuilhermeVgl/oddkin-comms/internal/installation"
	"github.com/GuilhermeVgl/oddkin-comms/internal/platform/migration"
	"github.com/GuilhermeVgl/oddkin-comms/internal/platform/objectstore"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, logger); err != nil {
		logger.Error("api stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, logger *slog.Logger) error {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	// One process owns the schema: it migrates under an advisory lock, then
	// creates the first administrator when asked to. Set AUTO_MIGRATE=false to
	// run `go run ./cmd/migrate` by hand instead.
	if os.Getenv("AUTO_MIGRATE") != "false" {
		if err := migration.Run(ctx, databaseURL); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
		logger.Info("migrations applied")
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return errors.New("DATABASE_URL is invalid")
	}
	defer pool.Close()
	if err := bootstrapAdministrator(ctx, logger, pool); err != nil {
		return err
	}

	address := os.Getenv("HTTP_ADDR")
	if address == "" {
		address = ":8080"
	}
	deliveryKey := []byte(os.Getenv("INVITATION_DELIVERY_KEY"))
	if len(deliveryKey) != 0 && len(deliveryKey) != 32 {
		return errors.New("INVITATION_DELIVERY_KEY must contain exactly 32 bytes")
	}
	store, err := objectstore.FromEnv()
	if err != nil {
		return err
	}
	quota, err := objectstore.QuotaFromEnv()
	if err != nil {
		return err
	}
	livekit, err := calls.FromEnv()
	if err != nil {
		return err
	}
	handler, err := httpapi.NewAppHandlerWithConfig(pool, httpapi.AppConfig{
		InvitationDeliveryKey: deliveryKey, ObjectStore: store, StorageQuotaBytes: quota, LiveKit: livekit,
	})
	if err != nil {
		return fmt.Errorf("initialize API authentication: %w", err)
	}
	if livekit.APIKey == "" {
		logger.Warn("LiveKit is not configured; calls are disabled")
	}
	if store == nil {
		logger.Warn("object storage is not configured; uploads are disabled")
	} else if os.Getenv("R2_CREATE_BUCKET") == "true" {
		if err := ensureBucket(ctx, logger, store); err != nil {
			return err
		}
	}
	jobsClient, err := startWorkers(ctx, logger, pool, deliveryKey, store, livekit)
	if err != nil {
		return err
	}
	defer func() {
		stopCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = jobsClient.Stop(stopCtx)
	}()
	server := &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.ListenAndServe() }()
	logger.Info("api listening", "address", address)

	select {
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve HTTP: %w", err)
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("shutdown HTTP: %w", err)
		}
		if err := <-serverErrors; err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve HTTP: %w", err)
		}
		return nil
	}
}

// bootstrapAdministrator creates the first administrator from the environment
// the first time the installation starts; later starts leave it alone.
func bootstrapAdministrator(ctx context.Context, logger *slog.Logger, pool *pgxpool.Pool) error {
	email, password := os.Getenv("ODDKIN_ADMIN_EMAIL"), os.Getenv("ODDKIN_ADMIN_PASSWORD")
	if email == "" && password == "" {
		return nil
	}
	if email == "" || password == "" {
		return errors.New("ODDKIN_ADMIN_EMAIL and ODDKIN_ADMIN_PASSWORD are required together")
	}
	timezone := os.Getenv("ODDKIN_TIMEZONE")
	if timezone == "" {
		timezone = "UTC"
	}
	err := installation.Bootstrap(ctx, pool, email, password, timezone)
	switch {
	case err == nil:
		logger.Info("installation bootstrap completed")
	case errors.Is(err, installation.ErrAlreadyInitialized):
		// Nothing to do: the administrator already exists.
	default:
		return fmt.Errorf("installation bootstrap failed: %w", err)
	}
	return nil
}

// ensureBucket is for local development against MinIO, where the bucket does
// not exist yet. Real R2 buckets are created in the Cloudflare dashboard.
func ensureBucket(ctx context.Context, logger *slog.Logger, store objectstore.Store) error {
	ensurer, ok := store.(objectstore.BucketEnsurer)
	if !ok {
		return nil
	}
	var err error
	for attempt := 0; attempt < 30; attempt++ {
		if err = ensurer.EnsureBucket(ctx); err == nil {
			logger.Info("object storage bucket is ready")
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return fmt.Errorf("object storage bucket: %w", err)
}
