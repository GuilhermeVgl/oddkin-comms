//go:build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/jobs"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

func TestOperationalProbeJobCompletes(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("configure test pool:", err)
	}
	defer pool.Close()
	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Queues:  map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: 1}},
		Workers: jobs.NewWorkers(pool),
	})
	if err != nil {
		t.Fatal("configure River client:", err)
	}
	events, unsubscribe := client.Subscribe(river.EventKindJobCompleted)
	defer unsubscribe()
	if err := client.Start(ctx); err != nil {
		t.Fatal("start River client:", err)
	}
	defer func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer stopCancel()
		if err := client.Stop(stopCtx); err != nil {
			t.Error("stop River client:", err)
		}
	}()
	inserted, err := client.Insert(ctx, jobs.ProbeArgs{}, nil)
	if err != nil {
		t.Fatal("insert probe job:", err)
	}
	select {
	case event := <-events:
		if event.Job.ID != inserted.Job.ID {
			t.Fatalf("completed unexpected job %d, want %d", event.Job.ID, inserted.Job.ID)
		}
	case <-ctx.Done():
		t.Fatal("probe job did not complete:", ctx.Err())
	}
}
