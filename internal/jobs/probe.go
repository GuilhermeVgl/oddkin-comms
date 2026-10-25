package jobs

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
)

type ProbeArgs struct{}

func (ProbeArgs) Kind() string { return "system_probe" }

type probeWorker struct {
	river.WorkerDefaults[ProbeArgs]
	pool *pgxpool.Pool
}

func (worker *probeWorker) Work(ctx context.Context, _ *river.Job[ProbeArgs]) error {
	return worker.pool.Ping(ctx)
}

func NewWorkers(pool *pgxpool.Pool) *river.Workers {
	workers := river.NewWorkers()
	river.AddWorker(workers, &probeWorker{pool: pool})
	return workers
}

func NewWorkersWithInvitationEmail(pool *pgxpool.Pool, mailer InvitationMailer, deliveryKey []byte, publicURL string) *river.Workers {
	workers := NewWorkers(pool)
	river.AddWorker(workers, &invitationEmailWorker{
		pool: pool, mailer: mailer, deliveryKey: append([]byte(nil), deliveryKey...), publicURL: publicURL,
	})
	river.AddWorker(workers, &passwordResetEmailWorker{
		pool: pool, mailer: mailer, deliveryKey: append([]byte(nil), deliveryKey...), publicURL: publicURL,
	})
	return workers
}
