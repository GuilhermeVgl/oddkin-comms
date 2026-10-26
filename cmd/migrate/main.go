package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/GuilhermeVgl/crewstead-comms/internal/platform/migration"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	admin, err := migration.AdminFromEnv()
	if err != nil {
		logger.Error("migration failed", "error", err)
		os.Exit(1)
	}
	if err := migration.RunWithAdmin(ctx, os.Getenv("DATABASE_URL"), admin); err != nil {
		logger.Error("migration failed", "error", err)
		os.Exit(1)
	}
	logger.Info("migrations applied")
}
