package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/calls"
	"github.com/GuilhermeVgl/oddkin-comms/internal/jobs"
	"github.com/GuilhermeVgl/oddkin-comms/internal/platform/objectstore"
	"github.com/GuilhermeVgl/oddkin-comms/internal/platform/resendmail"
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
	workers := jobs.NewWorkers(pool)
	queues := map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: 4}}
	apiKey := os.Getenv("RESEND_API_KEY")
	from := os.Getenv("RESEND_FROM_EMAIL")
	publicURL := os.Getenv("APP_PUBLIC_URL")
	deliveryKey := []byte(os.Getenv("INVITATION_DELIVERY_KEY"))
	endpoint := os.Getenv("RESEND_API_URL")
	configuredValues := 0
	for _, value := range []string{apiKey, from, publicURL, string(deliveryKey)} {
		if value != "" {
			configuredValues++
		}
	}
	if configuredValues != 0 {
		if configuredValues != 4 || len(deliveryKey) != 32 {
			return errors.New("RESEND_API_KEY, RESEND_FROM_EMAIL, APP_PUBLIC_URL and a 32-byte INVITATION_DELIVERY_KEY are required together")
		}
		var mailer *resendmail.Client
		if endpoint == "" {
			mailer, err = resendmail.New(apiKey, from)
		} else {
			mailer, err = resendmail.NewWithEndpoint(apiKey, from, endpoint)
		}
		if err != nil {
			return errors.New("resend configuration is invalid")
		}
		workers = jobs.NewWorkersWithInvitationEmail(pool, mailer, deliveryKey, publicURL)
		queues["email"] = river.QueueConfig{MaxWorkers: 2}
	}
	config := &river.Config{
		Queues:          queues,
		Workers:         workers,
		SoftStopTimeout: 30 * time.Second,
	}
	store, err := objectstore.FromEnv()
	if err != nil {
		return err
	}
	if store != nil {
		jobs.AddStorageWorker(workers, pool, store)
		config.PeriodicJobs = []*river.PeriodicJob{
			river.NewPeriodicJob(
				river.PeriodicInterval(10*time.Minute),
				func() (river.JobArgs, *river.InsertOpts) { return jobs.ReleaseStorageArgs{}, nil },
				&river.PeriodicJobOpts{RunOnStart: true},
			),
		}
	}
	livekit, err := calls.FromEnv()
	if err != nil {
		return err
	}
	if livekit.APIKey != "" {
		rooms, roomsErr := calls.NewRooms(livekit)
		if roomsErr != nil {
			return roomsErr
		}
		jobs.AddCallsWorker(workers, pool, rooms)
		config.PeriodicJobs = append(config.PeriodicJobs, river.NewPeriodicJob(
			river.PeriodicInterval(time.Minute),
			func() (river.JobArgs, *river.InsertOpts) { return jobs.ReconcileCallsArgs{}, nil },
			&river.PeriodicJobOpts{RunOnStart: true},
		))
	}
	client, err := river.NewClient(riverpgxv5.New(pool), config)
	if err != nil {
		return err
	}
	if err := client.Start(ctx); err != nil {
		return errors.New("could not start River worker")
	}
	<-client.Stopped()
	return nil
}
