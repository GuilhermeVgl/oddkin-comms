//go:build integration

package integration

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// openTestPool connects to TEST_DATABASE_URL. The context expires after timeout
// and both it and the pool are released when the test ends.
func openTestPool(t *testing.T, timeout time.Duration) (context.Context, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	t.Cleanup(cancel)
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return ctx, pool
}

// newTestOrganization inserts the organization with the given fixed ID. When the
// test ends it deletes the organization and then every account whose normalized
// email matches one of accountEmailLikePatterns.
func newTestOrganization(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id, timezone string, accountEmailLikePatterns ...string) pgtype.UUID {
	t.Helper()
	var organizationID pgtype.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ($1, $2) RETURNING id`, id, timezone).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID); err != nil {
			t.Error(err)
		}
		for _, pattern := range accountEmailLikePatterns {
			_, _ = pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized LIKE $1`, pattern)
		}
	})
	return organizationID
}

var (
	passwordHashesMu sync.Mutex
	passwordHashes   = map[string]string{}
)

// testPasswordHash hashes the password once per test binary; argon2 is slow.
func testPasswordHash(t *testing.T, password string) string {
	t.Helper()
	passwordHashesMu.Lock()
	defer passwordHashesMu.Unlock()
	if hash, ok := passwordHashes[password]; ok {
		return hash
	}
	hash, err := identity.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	passwordHashes[password] = hash
	return hash
}

// formatUUID renders the canonical text form of a UUID.
func formatUUID(id pgtype.UUID) string {
	return uuid.UUID(id.Bytes).String()
}

// createTestAccount creates an account with a membership in the organization and
// returns the account ID.
func createTestAccount(t *testing.T, ctx context.Context, queries *sqlc.Queries, orgID pgtype.UUID, email, password, kind string, admin bool) string {
	t.Helper()
	account, err := queries.CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: email, PasswordHash: testPasswordHash(t, password)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := queries.CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{
		OrganizationID: orgID, AccountID: account.ID, MembershipKind: kind, IsAdmin: admin,
	}); err != nil {
		t.Fatal(err)
	}
	return formatUUID(account.ID)
}

// createTestMembers creates one account per email. An email containing
// "external" gets an external membership and one containing "admin" is an
// administrator. It returns the account IDs by email.
func createTestMembers(t *testing.T, ctx context.Context, queries *sqlc.Queries, orgID pgtype.UUID, password string, emails []string) map[string]string {
	t.Helper()
	ids := make(map[string]string, len(emails))
	for _, email := range emails {
		kind := "internal"
		if strings.Contains(email, "external") {
			kind = "external"
		}
		ids[email] = createTestAccount(t, ctx, queries, orgID, email, password, kind, strings.Contains(email, "admin"))
	}
	return ids
}

// loginClientStatus posts the credentials to the login endpoint and returns a
// client holding whatever session and CSRF cookies came back, with the status.
func loginClientStatus(t *testing.T, handler http.Handler, email, password string) (*workClient, int) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"email":"`+email+`","password":"`+password+`"}`))
	req.Host = "crewstead.test"
	req.Header.Set("Origin", "http://crewstead.test")
	req.Header.Set("Content-Type", "application/json")
	result := httptest.NewRecorder()
	handler.ServeHTTP(result, req)
	client := &workClient{t: t, handler: handler}
	for _, cookie := range result.Result().Cookies() {
		switch cookie.Name {
		case "crewstead_session":
			client.session = cookie
		case "crewstead_csrf":
			client.csrf = cookie
		}
	}
	return client, result.Code
}

// loginClient logs in and fails the test unless the login succeeds.
func loginClient(t *testing.T, handler http.Handler, email, password string) *workClient {
	t.Helper()
	client, code := loginClientStatus(t, handler, email, password)
	if code != http.StatusNoContent {
		t.Fatalf("login %s: %d", email, code)
	}
	return client
}
