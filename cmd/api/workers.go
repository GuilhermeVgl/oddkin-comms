package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/calls"
	"github.com/GuilhermeVgl/oddkin-comms/internal/jobs"
	"github.com/GuilhermeVgl/oddkin-comms/internal/platform/objectstore"
	"github.com/GuilhermeVgl/oddkin-comms/internal/platform/resendmail"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// startWorkers runs the River workers inside the API process: for an
// installation this small a second container would only add a moving part.
// What is not configured is left out, and its jobs wait in the queue.
func startWorkers(ctx context.Context, logger *slog.Logger, pool *pgxpool.Pool, deliveryKey []byte, store objectstore.Store, livekit calls.Config) (*river.Client[pgx.Tx], error) {
	workers := jobs.NewWorkers(pool)
	queues := map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: 4}}
	config := &river.Config{Queues: queues, Workers: workers, SoftStopTimeout: 20 * time.Second}

	apiKey, from, publicURL := os.Getenv("RESEND_API_KEY"), os.Getenv("RESEND_FROM_EMAIL"), os.Getenv("APP_PUBLIC_URL")
	switch {
	case apiKey == "" && from == "":
		logger.Warn("e-mail is not configured (RESEND_API_KEY, RESEND_FROM_EMAIL); invitations and password resets stay queued until it is")
	case apiKey == "" || from == "" || publicURL == "" || len(deliveryKey) != 32:
		return nil, errors.New("RESEND_API_KEY, RESEND_FROM_EMAIL, APP_PUBLIC_URL and a 32-byte INVITATION_DELIVERY_KEY are required together")
	default:
		mailer, err := resendmail.New(apiKey, from)
		if err != nil {
			return nil, errors.New("resend configuration is invalid")
		}
		workers = jobs.NewWorkersWithInvitationEmail(pool, mailer, deliveryKey, publicURL)
		config.Workers = workers
		queues["email"] = river.QueueConfig{MaxWorkers: 2}
	}
	retention, err := jobs.RetentionFromEnv()
	if err != nil {
		return nil, err
	}
	jobs.AddRetentionWorker(workers, pool, retention)
	config.PeriodicJobs = append(config.PeriodicJobs, river.NewPeriodicJob(
		river.PeriodicInterval(24*time.Hour),
		func() (river.JobArgs, *river.InsertOpts) { return jobs.RetentionArgs{}, nil },
		&river.PeriodicJobOpts{RunOnStart: true},
	))
	if store != nil {
		jobs.AddStorageWorker(workers, pool, store)
		config.PeriodicJobs = append(config.PeriodicJobs, river.NewPeriodicJob(
			river.PeriodicInterval(10*time.Minute),
			func() (river.JobArgs, *river.InsertOpts) { return jobs.ReleaseStorageArgs{}, nil },
			&river.PeriodicJobOpts{RunOnStart: true},
		))
	}
	if livekit.APIKey != "" {
		rooms, err := calls.NewRooms(livekit)
		if err != nil {
			return nil, err
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
		return nil, fmt.Errorf("configure background jobs: %w", err)
	}
	if err := client.Start(ctx); err != nil {
		return nil, errors.New("could not start background jobs")
	}
	return client, nil
}
