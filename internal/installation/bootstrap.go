package installation

import (
	"context"
	"errors"
	"fmt"
	"time"
	_ "time/tzdata"

	"github.com/GuilhermeVgl/oddkin-comms/internal/identity"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrAlreadyInitialized = errors.New("installation already initialized")
var ErrInvalidTimezone = errors.New("invalid timezone")

const bootstrapLockID int64 = 0x4f44444b494e42

// Bootstrap creates the single organization and its first administrator together.
// It is called from a trusted local command, not from an unauthenticated HTTP route.
func Bootstrap(ctx context.Context, pool *pgxpool.Pool, rawEmail, password, timezone string) (err error) {
	email, err := identity.NormalizeEmail(rawEmail)
	if err != nil {
		return err
	}
	if timezone == "" {
		return ErrInvalidTimezone
	}
	if _, err := time.LoadLocation(timezone); err != nil {
		return ErrInvalidTimezone
	}
	passwordHash, err := identity.HashPassword(password)
	if err != nil {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin installation: %w", err)
	}
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if rollbackErr := tx.Rollback(cleanupCtx); rollbackErr != nil && !errors.Is(rollbackErr, pgx.ErrTxClosed) {
			err = errors.Join(err, fmt.Errorf("rollback installation: %w", rollbackErr))
		}
	}()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, bootstrapLockID); err != nil {
		return fmt.Errorf("lock installation: %w", err)
	}
	queries := sqlc.New(tx)
	if _, err := queries.GetOrganization(ctx); err == nil {
		return ErrAlreadyInitialized
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("check installation: %w", err)
	}
	newID, err := uuid.NewRandom()
	if err != nil {
		return fmt.Errorf("generate organization ID: %w", err)
	}
	orgID := pgtype.UUID{Bytes: newID, Valid: true}
	if _, err := queries.CreateOrganization(ctx, sqlc.CreateOrganizationParams{ID: orgID, Timezone: timezone}); err != nil {
		return fmt.Errorf("create organization: %w", err)
	}
	account, err := queries.CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: email, PasswordHash: passwordHash})
	if err != nil {
		return fmt.Errorf("create administrator account: %w", err)
	}
	if _, err := queries.CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{
		OrganizationID: orgID, AccountID: account.ID, MembershipKind: "internal", IsAdmin: true,
	}); err != nil {
		return fmt.Errorf("create administrator membership: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit installation: %w", err)
	}
	return nil
}
