package jobs

import (
	"context"

	"github.com/GuilhermeVgl/crewstead-comms/internal/calls"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
)

// ReconcileCallsArgs is the periodic comparison of call seats with LiveKit.
type ReconcileCallsArgs struct{}

func (ReconcileCallsArgs) Kind() string { return "reconcile_calls" }

type reconcileCallsWorker struct {
	river.WorkerDefaults[ReconcileCallsArgs]
	pool  *pgxpool.Pool
	rooms calls.Rooms
}

func (worker *reconcileCallsWorker) Work(ctx context.Context, _ *river.Job[ReconcileCallsArgs]) error {
	return calls.Reconcile(ctx, worker.pool, worker.rooms)
}

// AddCallsWorker registers the reconciliation worker.
func AddCallsWorker(workers *river.Workers, pool *pgxpool.Pool, rooms calls.Rooms) {
	river.AddWorker(workers, &reconcileCallsWorker{pool: pool, rooms: rooms})
}
