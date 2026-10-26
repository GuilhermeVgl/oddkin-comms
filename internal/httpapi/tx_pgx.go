package httpapi

import (
	"context"

	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
)

// inTxPgx is inTx for callbacks that also need the raw transaction, for example
// to enqueue a River job atomically with the change (InsertTx). The same rules
// apply: commit when fn returns nil, roll back otherwise, and answer with
// respondError.
func (h *apiServer) inTxPgx(ctx context.Context, fn func(tx pgx.Tx, q *sqlc.Queries) error) error {
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err = fn(tx, sqlc.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
