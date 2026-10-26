package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"

	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
)

// Retention holds how many days each kind of operational record is kept.
type Retention struct {
	SessionDays, CallDays, AuditDays int32
}

// DefaultRetention follows SPEC 15.4: call metadata 30 days, administrative
// audit 180 days. Session and reset records are only useful for a short while.
func DefaultRetention() Retention {
	return Retention{SessionDays: 14, CallDays: 30, AuditDays: 180}
}

// RetentionFromEnv lets RETENTION_SESSION_DAYS, RETENTION_CALL_DAYS and
// RETENTION_AUDIT_DAYS override the defaults.
func RetentionFromEnv() (Retention, error) {
	retention := DefaultRetention()
	for name, target := range map[string]*int32{
		"RETENTION_SESSION_DAYS": &retention.SessionDays,
		"RETENTION_CALL_DAYS":    &retention.CallDays,
		"RETENTION_AUDIT_DAYS":   &retention.AuditDays,
	} {
		raw := os.Getenv(name)
		if raw == "" {
			continue
		}
		days, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || days < 1 {
			return retention, fmt.Errorf("%s must be a positive number of days", name)
		}
		*target = int32(days)
	}
	return retention, nil
}

type RetentionArgs struct{}

func (RetentionArgs) Kind() string { return "retention" }

type retentionWorker struct {
	river.WorkerDefaults[RetentionArgs]
	pool      *pgxpool.Pool
	retention Retention
}

// AddRetentionWorker registers the daily cleanup.
func AddRetentionWorker(workers *river.Workers, pool *pgxpool.Pool, retention Retention) {
	river.AddWorker(workers, &retentionWorker{pool: pool, retention: retention})
}

func (worker *retentionWorker) Work(ctx context.Context, _ *river.Job[RetentionArgs]) error {
	removed, err := PurgeExpired(ctx, worker.pool, worker.retention)
	if err != nil {
		return err
	}
	slog.Info("retention applied", "sessions", removed.Sessions, "resets", removed.Resets, "calls", removed.Calls, "webhooks", removed.Webhooks, "audit", removed.Audit)
	return nil
}

// Purged counts the rows each rule removed.
type Purged struct {
	Sessions, Resets, Calls, Webhooks, Audit int64
}

// PurgeExpired deletes what is past its retention. Every rule is a plain
// DELETE, so running it twice, or concurrently, is harmless.
func PurgeExpired(ctx context.Context, pool *pgxpool.Pool, retention Retention) (Purged, error) {
	q := sqlc.New(pool)
	var (
		purged Purged
		err    error
	)
	if purged.Sessions, err = q.PurgeOldSessions(ctx, retention.SessionDays); err != nil {
		return purged, fmt.Errorf("purge sessions: %w", err)
	}
	if purged.Resets, err = q.PurgeOldPasswordResets(ctx, retention.SessionDays); err != nil {
		return purged, fmt.Errorf("purge password resets: %w", err)
	}
	if purged.Calls, err = q.PurgeOldCalls(ctx, retention.CallDays); err != nil {
		return purged, fmt.Errorf("purge calls: %w", err)
	}
	if purged.Webhooks, err = q.PurgeOldWebhookEvents(ctx, retention.CallDays); err != nil {
		return purged, fmt.Errorf("purge call webhooks: %w", err)
	}
	if purged.Audit, err = q.PurgeOldRecoveryAudit(ctx, retention.AuditDays); err != nil {
		return purged, fmt.Errorf("purge audit: %w", err)
	}
	return purged, nil
}
