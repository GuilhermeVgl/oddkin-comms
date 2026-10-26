package jobs

import (
	"context"
	"fmt"

	"github.com/GuilhermeVgl/crewstead-comms/internal/platform/objectstore"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
)

// ReleaseStorageArgs is the periodic reconciliation of attachment storage.
type ReleaseStorageArgs struct{}

func (ReleaseStorageArgs) Kind() string { return "release_storage" }

type releaseStorageWorker struct {
	river.WorkerDefaults[ReleaseStorageArgs]
	pool  *pgxpool.Pool
	store objectstore.Store
}

func (worker *releaseStorageWorker) Work(ctx context.Context, _ *river.Job[ReleaseStorageArgs]) error {
	return ReleaseStorage(ctx, worker.pool, worker.store)
}

// AddStorageWorker registers the reconciliation worker.
func AddStorageWorker(workers *river.Workers, pool *pgxpool.Pool, store objectstore.Store) {
	river.AddWorker(workers, &releaseStorageWorker{pool: pool, store: store})
}

// ReleaseStorage abandons uploads older than 24 hours and then frees the bucket
// resources of every aborted or deleted attachment. It is idempotent: a
// failure leaves the row marked so the next run retries it.
func ReleaseStorage(ctx context.Context, pool *pgxpool.Pool, store objectstore.Store) error {
	if _, err := sqlc.New(pool).AbandonExpiredUploads(ctx); err != nil {
		return fmt.Errorf("abandon expired uploads: %w", err)
	}
	q := sqlc.New(pool)
	pending, err := q.ListPendingRelease(ctx)
	if err != nil {
		return err
	}
	var failures int
	for _, attachment := range pending {
		if releaseErr := objectstore.Release(ctx, store, attachment.State, attachment.ObjectKey, attachment.UploadID); releaseErr != nil {
			failures++
			continue
		}
		if err = q.MarkAttachmentObjectRemoved(ctx, attachment.ID); err != nil {
			return err
		}
	}
	if failures > 0 {
		return fmt.Errorf("%d attachments could not be released yet", failures)
	}
	return nil
}
