//go:build integration

package integration

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
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

type recordingInvitationMailer struct {
	messages chan resendmail.Message
}

func (mailer *recordingInvitationMailer) Send(_ context.Context, message resendmail.Message) (string, error) {
	if message.To == "permanent-failure@example.test" {
		return "", &resendmail.SendError{StatusCode: http.StatusBadRequest, Retryable: false}
	}
	mailer.messages <- message
	return "synthetic-provider-id", nil
}

func TestInvitationHTTPRequiresOrganizationAdministrator(t *testing.T) {
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

	var organizationID pgtype.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ('71000000-0000-4000-8000-000000000001', 'UTC') RETURNING id`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized IN ('invite-admin@example.test', 'invite-member@example.test')`)
	}()

	passwordHash, err := identity.HashPassword("correct invitation password")
	if err != nil {
		t.Fatal(err)
	}
	queries := sqlc.New(pool)
	createAccount := func(email string, admin bool) {
		account, createErr := queries.CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: email, PasswordHash: passwordHash})
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, createErr = queries.CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{
			OrganizationID: organizationID, AccountID: account.ID, MembershipKind: "internal", IsAdmin: admin,
		}); createErr != nil {
			t.Fatal(createErr)
		}
	}
	createAccount("invite-admin@example.test", true)
	createAccount("invite-member@example.test", false)

	deliveryKey := bytes.Repeat([]byte{0x42}, identity.InvitationDeliveryKeySize)
	handler, err := httpapi.NewAppHandlerWithConfig(pool, httpapi.AppConfig{
		InvitationDeliveryKey: deliveryKey,
	})
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path, body string) *http.Request {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body)).WithContext(ctx)
		req.Host = "crewstead.test"
		req.Header.Set("Origin", "http://crewstead.test")
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		return req
	}
	login := func(email string) (*http.Cookie, *http.Cookie) {
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, request(http.MethodPost, "/api/v1/auth/login", `{"email":"`+email+`","password":"correct invitation password"}`))
		if result.Code != http.StatusNoContent {
			t.Fatalf("login %s: status=%d", email, result.Code)
		}
		var session, csrf *http.Cookie
		for _, cookie := range result.Result().Cookies() {
			switch cookie.Name {
			case "crewstead_session":
				session = cookie
			case "crewstead_csrf":
				csrf = cookie
			}
		}
		return session, csrf
	}
	postInvitation := func(session, csrf *http.Cookie, email, kind string) *httptest.ResponseRecorder {
		req := request(http.MethodPost, "/api/v1/invitations", fmt.Sprintf(`{"email":%q,"membershipKind":%q}`, email, kind))
		req.AddCookie(session)
		req.Header.Set("X-CSRF-Token", csrf.Value)
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		return result
	}
	unauthenticated := request(http.MethodPost, "/api/v1/invitations", `{"email":"new-person@example.test","membershipKind":"external"}`)
	unauthenticatedResult := httptest.NewRecorder()
	handler.ServeHTTP(unauthenticatedResult, unauthenticated)
	if unauthenticatedResult.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated invitation: status=%d", unauthenticatedResult.Code)
	}

	memberSession, memberCSRF := login("invite-member@example.test")
	if result := postInvitation(memberSession, memberCSRF, "new-person@example.test", "external"); result.Code != http.StatusForbidden {
		t.Fatalf("non-admin created invitation: status=%d body=%q", result.Code, result.Body.String())
	}
	adminSession, adminCSRF := login("invite-admin@example.test")
	crossOrigin := request(http.MethodPost, "/api/v1/invitations", `{"email":"new-person@example.test","membershipKind":"external"}`)
	crossOrigin.AddCookie(adminSession)
	crossOrigin.Header.Set("X-CSRF-Token", adminCSRF.Value)
	crossOrigin.Header.Set("Origin", "http://other.test")
	crossOriginResult := httptest.NewRecorder()
	handler.ServeHTTP(crossOriginResult, crossOrigin)
	if crossOriginResult.Code != http.StatusForbidden {
		t.Fatalf("cross-origin invitation: status=%d", crossOriginResult.Code)
	}
	missingCSRF := request(http.MethodPost, "/api/v1/invitations", `{"email":"new-person@example.test","membershipKind":"external"}`)
	missingCSRF.AddCookie(adminSession)
	missingCSRFResult := httptest.NewRecorder()
	handler.ServeHTTP(missingCSRFResult, missingCSRF)
	if missingCSRFResult.Code != http.StatusForbidden {
		t.Fatalf("invitation without CSRF: status=%d", missingCSRFResult.Code)
	}
	if result := postInvitation(adminSession, adminCSRF, "invalid", "external"); result.Code != http.StatusBadRequest {
		t.Fatalf("invalid recipient accepted: status=%d", result.Code)
	}
	if result := postInvitation(adminSession, adminCSRF, "new-person@example.test", "owner"); result.Code != http.StatusBadRequest {
		t.Fatalf("invalid membership accepted: status=%d", result.Code)
	}
	if result := postInvitation(adminSession, adminCSRF, "new-person@example.test", "external"); result.Code != http.StatusCreated {
		t.Fatalf("admin invitation: status=%d body=%q", result.Code, result.Body.String())
	}
	if result := postInvitation(adminSession, adminCSRF, "new-person@example.test", "external"); result.Code != http.StatusCreated {
		t.Fatalf("replacement invitation: status=%d body=%q", result.Code, result.Body.String())
	}
	var invitations int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM organization_invitation WHERE organization_id = $1 AND email_normalized = 'new-person@example.test' AND membership_kind = 'external'`, organizationID).Scan(&invitations); err != nil || invitations != 2 {
		t.Fatalf("persisted invitations=%d err=%v", invitations, err)
	}

	var invitationID pgtype.UUID
	var sealedToken []byte
	if err := pool.QueryRow(ctx, `SELECT i.id, d.token_ciphertext FROM organization_invitation AS i JOIN invitation_delivery AS d ON d.invitation_id = i.id WHERE i.email_normalized = 'new-person@example.test' AND i.revoked_at IS NULL`).Scan(&invitationID, &sealedToken); err != nil {
		t.Fatal(err)
	}
	token, err := identity.OpenInvitationToken(deliveryKey, sealedToken)
	if err != nil || bytes.Contains(sealedToken, []byte(token)) {
		t.Fatalf("invitation delivery token was not protected: %v", err)
	}
	badContentType := request(http.MethodPost, "/api/v1/invitations/accept", `{}`)
	badContentType.Header.Del("Content-Type")
	badContentTypeResult := httptest.NewRecorder()
	handler.ServeHTTP(badContentTypeResult, badContentType)
	if badContentTypeResult.Code != http.StatusBadRequest {
		t.Fatalf("accept without JSON content type: status=%d", badContentTypeResult.Code)
	}
	malformedToken := httptest.NewRecorder()
	handler.ServeHTTP(malformedToken, request(http.MethodPost, "/api/v1/invitations/accept", `{"email":"new-person@example.test","token":"invalid"}`))
	if malformedToken.Code != http.StatusBadRequest {
		t.Fatalf("malformed token accepted: status=%d", malformedToken.Code)
	}
	trailingJSON := httptest.NewRecorder()
	handler.ServeHTTP(trailingJSON, request(http.MethodPost, "/api/v1/invitations/accept", `{"email":"new-person@example.test","token":"invalid"}{}`))
	if trailingJSON.Code != http.StatusBadRequest {
		t.Fatalf("trailing JSON accepted: status=%d", trailingJSON.Code)
	}
	crossOriginAccept := request(http.MethodPost, "/api/v1/invitations/accept", fmt.Sprintf(`{"email":"new-person@example.test","token":%q}`, token))
	crossOriginAccept.Header.Set("Origin", "http://other.test")
	crossOriginAcceptResult := httptest.NewRecorder()
	handler.ServeHTTP(crossOriginAcceptResult, crossOriginAccept)
	if crossOriginAcceptResult.Code != http.StatusForbidden {
		t.Fatalf("cross-origin acceptance: status=%d", crossOriginAcceptResult.Code)
	}
	mailer := &recordingInvitationMailer{messages: make(chan resendmail.Message, 1)}
	workers := jobs.NewWorkersWithInvitationEmail(pool, mailer, deliveryKey, "https://crewstead.example")
	jobClient, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Queues: map[string]river.QueueConfig{
			river.QueueDefault: {MaxWorkers: 1},
			"email":            {MaxWorkers: 1},
		},
		Workers: workers,
	})
	if err != nil {
		t.Fatal(err)
	}
	events, unsubscribe := jobClient.Subscribe(river.EventKindJobCompleted, river.EventKindJobCancelled)
	defer unsubscribe()
	if err := jobClient.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer stopCancel()
		if err := jobClient.Stop(stopCtx); err != nil {
			t.Error(err)
		}
	}()
	select {
	case message := <-mailer.messages:
		if message.To != "new-person@example.test" || message.Subject != "Convite Crewstead" ||
			!bytes.Contains([]byte(message.Text), []byte("#accept-invitation?")) ||
			!bytes.Contains([]byte(message.Text), []byte(token)) {
			t.Fatalf("unexpected invitation email: %+v", message)
		}
	case <-ctx.Done():
		t.Fatal("invitation email job did not run:", ctx.Err())
	}
	for range 2 {
		select {
		case <-events:
		case <-ctx.Done():
			t.Fatal("invitation email jobs did not complete:", ctx.Err())
		}
	}
	var state string
	var providerID pgtype.Text
	err = pool.QueryRow(ctx, `SELECT state, provider_id FROM invitation_delivery WHERE invitation_id = $1`, invitationID).Scan(&state, &providerID)
	if err != nil || state != "sent" || providerID.String != "synthetic-provider-id" {
		t.Fatalf("delivery was not marked sent: state=%q provider=%q err=%v", state, providerID.String, err)
	}

	if result := postInvitation(adminSession, adminCSRF, "permanent-failure@example.test", "external"); result.Code != http.StatusCreated {
		t.Fatalf("permanent failure invitation: status=%d", result.Code)
	}
	select {
	case event := <-events:
		if event.Kind != river.EventKindJobCancelled {
			t.Fatalf("permanent delivery failure event=%s", event.Kind)
		}
	case <-ctx.Done():
		t.Fatal("permanent delivery failure job did not finish:", ctx.Err())
	}
	var failedState string
	if err := pool.QueryRow(ctx, `SELECT d.state FROM invitation_delivery AS d JOIN organization_invitation AS i ON i.id = d.invitation_id WHERE i.email_normalized = 'permanent-failure@example.test'`).Scan(&failedState); err != nil || failedState != "failed" {
		t.Fatalf("permanent delivery state=%q err=%v", failedState, err)
	}

	wrongRecipient := httptest.NewRecorder()
	handler.ServeHTTP(wrongRecipient, request(http.MethodPost, "/api/v1/invitations/accept",
		fmt.Sprintf(`{"email":"other@example.test","token":%q,"password":"new person password"}`, token)))
	if wrongRecipient.Code != http.StatusBadRequest {
		t.Fatalf("wrong recipient accepted invitation: status=%d", wrongRecipient.Code)
	}
	missingPassword := httptest.NewRecorder()
	handler.ServeHTTP(missingPassword, request(http.MethodPost, "/api/v1/invitations/accept",
		fmt.Sprintf(`{"email":"new-person@example.test","token":%q}`, token)))
	if missingPassword.Code != http.StatusBadRequest {
		t.Fatalf("new account invitation accepted without password: status=%d", missingPassword.Code)
	}
	shortPassword := httptest.NewRecorder()
	handler.ServeHTTP(shortPassword, request(http.MethodPost, "/api/v1/invitations/accept",
		fmt.Sprintf(`{"email":"new-person@example.test","token":%q,"password":"short"}`, token)))
	if shortPassword.Code != http.StatusBadRequest {
		t.Fatalf("short invitation password accepted: status=%d", shortPassword.Code)
	}
	accepted := httptest.NewRecorder()
	handler.ServeHTTP(accepted, request(http.MethodPost, "/api/v1/invitations/accept",
		fmt.Sprintf(`{"email":"new-person@example.test","token":%q,"password":"new person password"}`, token)))
	if accepted.Code != http.StatusNoContent {
		t.Fatalf("accept invitation: status=%d body=%q", accepted.Code, accepted.Body.String())
	}
	replayed := httptest.NewRecorder()
	handler.ServeHTTP(replayed, request(http.MethodPost, "/api/v1/invitations/accept",
		fmt.Sprintf(`{"email":"new-person@example.test","token":%q,"password":"new person password"}`, token)))
	if replayed.Code != http.StatusBadRequest {
		t.Fatalf("invitation replay accepted: status=%d", replayed.Code)
	}
	var membershipKind string
	var clearedToken []byte
	err = pool.QueryRow(ctx, `SELECT m.membership_kind, d.token_ciphertext FROM organization_membership AS m JOIN account AS a ON a.id = m.account_id JOIN organization_invitation AS i ON i.organization_id = m.organization_id AND i.email_normalized = a.email_normalized JOIN invitation_delivery AS d ON d.invitation_id = i.id WHERE a.email_normalized = 'new-person@example.test'`).Scan(&membershipKind, &clearedToken)
	if err != nil || membershipKind != "external" || !bytes.Equal(clearedToken, []byte{0}) {
		t.Fatalf("accepted membership: kind=%q cleared=%x err=%v", membershipKind, clearedToken, err)
	}

	if result := postInvitation(adminSession, adminCSRF, "invite-member@example.test", "internal"); result.Code != http.StatusCreated {
		t.Fatalf("existing account invitation: status=%d body=%q", result.Code, result.Body.String())
	}
	var existingSealedToken []byte
	if err := pool.QueryRow(ctx, `SELECT d.token_ciphertext FROM organization_invitation AS i JOIN invitation_delivery AS d ON d.invitation_id = i.id WHERE i.email_normalized = 'invite-member@example.test' ORDER BY i.created_at DESC LIMIT 1`).Scan(&existingSealedToken); err != nil {
		t.Fatal(err)
	}
	existingToken, err := identity.OpenInvitationToken(deliveryKey, existingSealedToken)
	if err != nil {
		t.Fatal(err)
	}
	existingBody := fmt.Sprintf(`{"email":"invite-member@example.test","token":%q}`, existingToken)
	withoutSession := httptest.NewRecorder()
	handler.ServeHTTP(withoutSession, request(http.MethodPost, "/api/v1/invitations/accept", existingBody))
	if withoutSession.Code != http.StatusBadRequest {
		t.Fatalf("existing account invitation accepted without session: status=%d", withoutSession.Code)
	}
	withSessionRequest := request(http.MethodPost, "/api/v1/invitations/accept", existingBody)
	withSessionRequest.AddCookie(memberSession)
	withSession := httptest.NewRecorder()
	handler.ServeHTTP(withSession, withSessionRequest)
	if withSession.Code != http.StatusNoContent {
		t.Fatalf("existing account invitation rejected with matching session: status=%d", withSession.Code)
	}
}
