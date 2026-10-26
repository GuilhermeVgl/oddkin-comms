//go:build integration

package integration

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi"
	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/jobs"
	"github.com/GuilhermeVgl/crewstead-comms/internal/platform/resendmail"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// A reset link works once, ends every earlier session, never reveals whether an
// e-mail has an account and says nothing about encrypted history.
func TestPasswordResetFlow(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	var organizationID pgtype.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ('75000000-0000-4000-8000-000000000041', 'UTC') RETURNING id`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized = 'reset-user@example.test'`)
	}()
	oldPassword, newPassword := "old reset password one", "new reset password two"
	hash, err := identity.HashPassword(oldPassword)
	if err != nil {
		t.Fatal(err)
	}
	queries := sqlc.New(pool)
	account, err := queries.CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: "reset-user@example.test", PasswordHash: hash})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = queries.CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{
		OrganizationID: organizationID, AccountID: account.ID, MembershipKind: "internal",
	}); err != nil {
		t.Fatal(err)
	}

	key := bytes.Repeat([]byte{0x24}, identity.InvitationDeliveryKeySize)
	handler, err := httpapi.NewAppHandlerWithConfig(pool, httpapi.AppConfig{InvitationDeliveryKey: key})
	if err != nil {
		t.Fatal(err)
	}
	mailer := &recordingInvitationMailer{messages: make(chan resendmail.Message, 4)}
	jobClient, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Queues:  map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: 1}, "email": {MaxWorkers: 1}},
		Workers: jobs.NewWorkersWithInvitationEmail(pool, mailer, key, "https://crewstead.example"),
	})
	if err != nil {
		t.Fatal(err)
	}
	events, unsubscribe := jobClient.Subscribe(river.EventKindJobCompleted)
	defer unsubscribe()
	if err := jobClient.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer stopCancel()
		_ = jobClient.Stop(stopCtx)
	}()

	call := func(method, path, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body)).WithContext(ctx)
		req.Host = "crewstead.test"
		req.Header.Set("Origin", "http://crewstead.test")
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		return result
	}
	login := func(password string) (int, *http.Cookie) {
		result := call(http.MethodPost, "/api/v1/auth/login", fmt.Sprintf(`{"email":"reset-user@example.test","password":%q}`, password))
		for _, cookie := range result.Result().Cookies() {
			if cookie.Name == "crewstead_session" {
				return result.Code, cookie
			}
		}
		return result.Code, nil
	}
	code, earlier := login(oldPassword)
	if code != http.StatusNoContent || earlier == nil {
		t.Fatalf("login before reset: %d", code)
	}

	// The answer is the same whether or not the account exists, and nothing is sent for strangers.
	if result := call(http.MethodPost, "/api/v1/auth/password-reset", `{"email":"nobody-here@example.test"}`); result.Code != http.StatusAccepted {
		t.Fatalf("unknown e-mail: %d", result.Code)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM password_reset`).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("a stranger must not create a reset: %d %v", rows, err)
	}
	crossOrigin := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset", bytes.NewBufferString(`{"email":"reset-user@example.test"}`))
	crossOrigin.Host = "crewstead.test"
	crossOrigin.Header.Set("Origin", "http://other.test")
	crossOrigin.Header.Set("Content-Type", "application/json")
	blocked := httptest.NewRecorder()
	handler.ServeHTTP(blocked, crossOrigin)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("cross-origin request: %d", blocked.Code)
	}

	if result := call(http.MethodPost, "/api/v1/auth/password-reset", `{"email":"Reset-User@Example.test"}`); result.Code != http.StatusAccepted {
		t.Fatalf("known e-mail: %d", result.Code)
	}
	var message resendmail.Message
	select {
	case message = <-mailer.messages:
	case <-ctx.Done():
		t.Fatal("reset e-mail was not sent:", ctx.Err())
	}
	found := regexp.MustCompile(`#reset-password\?token=([A-Za-z0-9_-]{43})`).FindStringSubmatch(message.Text)
	if message.To != "reset-user@example.test" || found == nil {
		t.Fatalf("unexpected reset e-mail: %+v", message)
	}
	token := found[1]
	if bytes.Contains([]byte(message.Text), []byte(newPassword)) {
		t.Fatal("the e-mail must not carry passwords")
	}
	select {
	case <-events:
	case <-ctx.Done():
		t.Fatal("job did not complete:", ctx.Err())
	}
	var sealed []byte
	if err := pool.QueryRow(ctx, `SELECT token_ciphertext FROM password_reset`).Scan(&sealed); err != nil || sealed != nil {
		t.Fatalf("the sealed token must be erased once sent: %v %v", sealed, err)
	}

	confirm := func(token, password string) int {
		return call(http.MethodPost, "/api/v1/auth/password-reset/confirm", fmt.Sprintf(`{"token":%q,"password":%q}`, token, password)).Code
	}
	if code := confirm("A"+token[1:], newPassword); code != http.StatusNotFound {
		t.Fatalf("wrong token: %d", code)
	}
	if code := confirm(token, "short"); code == http.StatusNoContent {
		t.Fatal("a weak password must be refused")
	}
	if code := confirm(token, newPassword); code != http.StatusNoContent {
		t.Fatalf("confirm: %d", code)
	}
	if code := confirm(token, newPassword+"x"); code != http.StatusNotFound {
		t.Fatalf("a token works once: %d", code)
	}
	if result := call(http.MethodGet, "/api/v1/auth/me", "", earlier); result.Code != http.StatusUnauthorized {
		t.Fatalf("earlier sessions must end: %d", result.Code)
	}
	if code, _ := login(oldPassword); code != http.StatusUnauthorized {
		t.Fatalf("old password: %d", code)
	}
	if code, cookie := login(newPassword); code != http.StatusNoContent || cookie == nil {
		t.Fatalf("new password: %d", code)
	}
}
