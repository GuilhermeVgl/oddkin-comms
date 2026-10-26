//go:build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/jobs"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Records past their retention are removed; recent ones, and sessions still in
// use, stay.
func TestRetentionRemovesOnlyWhatIsPastItsPeriod(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	hash, err := identity.HashPassword("correct retention password")
	if err != nil {
		t.Fatal(err)
	}
	created, err := sqlc.New(pool).CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: "retention@example.test", PasswordHash: hash})
	if err != nil {
		t.Fatal(err)
	}
	accountID := uuid.UUID(created.ID.Bytes).String()
	defer func() { _, _ = pool.Exec(context.Background(), `DELETE FROM account WHERE id = $1`, accountID) }()
	session := func(tag byte, createdAgo, expiresIn string, revokedAgo *string) {
		revoked := "NULL"
		if revokedAgo != nil {
			revoked = "now() - interval '" + *revokedAgo + "'"
		}
		query := `INSERT INTO auth_session (account_id, token_hash, csrf_hash, created_at, expires_at, revoked_at)
			VALUES ($1, decode(repeat($2, 32), 'hex'), decode(repeat('ab', 32), 'hex'), now() - interval '` + createdAgo + `', now() + interval '` + expiresIn + `', ` + revoked + `)`
		if _, err := pool.Exec(ctx, query, accountID, string([]byte{'0' + tag, '0' + tag})); err != nil {
			t.Fatal(err)
		}
	}
	old, recent := "30 days", "1 day"
	session(1, "40 days", "-35 days", nil)  // expired long ago
	session(2, "40 days", "1 day", &old)    // revoked long ago
	session(3, "2 days", "5 days", &recent) // revoked yesterday
	session(4, "1 hour", "7 days", nil)     // in use

	purged, err := jobs.PurgeExpired(ctx, pool, jobs.DefaultRetention())
	if err != nil {
		t.Fatal(err)
	}
	if purged.Sessions != 2 {
		t.Fatalf("sessions removed: %d", purged.Sessions)
	}
	var remaining int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM auth_session WHERE account_id = $1`, accountID).Scan(&remaining); err != nil || remaining != 2 {
		t.Fatalf("remaining sessions: %d %v", remaining, err)
	}
	again, err := jobs.PurgeExpired(ctx, pool, jobs.DefaultRetention())
	if err != nil || again.Sessions != 0 {
		t.Fatalf("a second run is a no-op: %+v %v", again, err)
	}
}
