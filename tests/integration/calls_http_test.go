//go:build integration

package integration

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/calls"
	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi"
	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/keys"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/livekit/protocol/auth"
)

var liveKitTestConfig = calls.Config{
	URL: "wss://media.example.test", APIURL: "https://media.example.test",
	APIKey: "SYNTHETICKEY", APISecret: "synthetic-secret-synthetic-secret-1234",
}

type callDTO struct {
	Id           string
	State        string
	CanEnd       bool
	InvitedMe    bool
	Participants []struct{ AccountId, Email, State string }
}

type ticketDTO struct {
	Url, Token, Identity string
	ReservedForSeconds   int
}

func TestCallsAdmissionLimitReconciliationAndPermissions(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var organizationID pgtype.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ('78000000-0000-4000-8000-000000000001', 'UTC') RETURNING id`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized LIKE 'call-%@example.test'`)
	}()
	hash, err := identity.HashPassword("correct calls password")
	if err != nil {
		t.Fatal(err)
	}
	queries := sqlc.New(pool)
	emails := []string{"call-admin@example.test", "call-u1@example.test", "call-u2@example.test", "call-u3@example.test", "call-u4@example.test", "call-u5@example.test", "call-external@example.test", "call-outsider@example.test"}
	ids := map[string]string{}
	for _, email := range emails {
		account, createErr := queries.CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: email, PasswordHash: hash})
		if createErr != nil {
			t.Fatal(createErr)
		}
		kind := "internal"
		if strings.Contains(email, "external") {
			kind = "external"
		}
		if _, createErr = queries.CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{
			OrganizationID: organizationID, AccountID: account.ID, MembershipKind: kind, IsAdmin: strings.Contains(email, "admin"),
		}); createErr != nil {
			t.Fatal(createErr)
		}
		ids[email] = fmt.Sprintf("%x-%x-%x-%x-%x", account.ID.Bytes[0:4], account.ID.Bytes[4:6], account.ID.Bytes[6:8], account.ID.Bytes[8:10], account.ID.Bytes[10:16])
	}
	rooms := calls.NewFakeRooms()
	handler, err := httpapi.NewAppHandlerWithConfig(pool, httpapi.AppConfig{LiveKit: liveKitTestConfig, Rooms: rooms})
	if err != nil {
		t.Fatal(err)
	}
	unconfigured, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	login := func(h http.Handler, email string) *workClient {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"email":"`+email+`","password":"correct calls password"}`))
		req.Host = "crewstead.test"
		req.Header.Set("Origin", "http://crewstead.test")
		req.Header.Set("Content-Type", "application/json")
		result := httptest.NewRecorder()
		h.ServeHTTP(result, req)
		if result.Code != http.StatusNoContent {
			t.Fatalf("login %s: %d", email, result.Code)
		}
		c := &workClient{t: t, handler: h}
		for _, cookie := range result.Result().Cookies() {
			if cookie.Name == "crewstead_session" {
				c.session = cookie
			}
			if cookie.Name == "crewstead_csrf" {
				c.csrf = cookie
			}
		}
		return c
	}
	admin := login(handler, emails[0])
	users := make([]*workClient, 5)
	for i := range users {
		users[i] = login(handler, emails[i+1])
	}
	external, outsider := login(handler, emails[6]), login(handler, emails[7])

	// Every seat needs a trusted device: media keys are sealed for it.
	rootPublic, rootSecret, _ := ed25519.GenerateKey(rand.Reader)
	if code := admin.do(http.MethodPut, "/api/v1/e2ee/trust-root", fmt.Sprintf(`{"signPublicKey":%q}`, b64url.EncodeToString(rootPublic)), nil); code != http.StatusOK {
		t.Fatalf("trust root: %d", code)
	}
	activate := func(client *workClient, email string) string {
		public, secret, _ := ed25519.GenerateKey(rand.Reader)
		box := make([]byte, 32)
		_, _ = rand.Read(box)
		var created deviceDTO
		if code := client.do(http.MethodPost, "/api/v1/devices", fmt.Sprintf(`{"name":"Dispositivo","signPublicKey":%q,"boxPublicKey":%q}`, b64url.EncodeToString(public), b64url.EncodeToString(box)), &created); code != http.StatusCreated {
			t.Fatalf("register device: %d", code)
		}
		_ = secret
		certificate := b64url.EncodeToString(ed25519.Sign(rootSecret, keys.DeviceCertificateBytes(keys.DeviceCertificate{AccountID: ids[email], DeviceID: created.Id, SignPublicKey: public, BoxPublicKey: box})))
		if code := admin.do(http.MethodPost, "/api/v1/devices/"+created.Id+"/authorize", fmt.Sprintf(`{"certificate":%q}`, certificate), nil); code != http.StatusOK {
			t.Fatalf("authorize device: %d", code)
		}
		return created.Id
	}
	clientOf := map[string]*workClient{emails[0]: admin, emails[6]: external, emails[7]: outsider}
	for i := range users {
		clientOf[emails[i+1]] = users[i]
	}
	deviceOf := map[string]string{}
	for _, email := range emails[:7] {
		deviceOf[email] = activate(clientOf[email], email)
	}
	joinBody := func(email string) string { return `{"deviceId":"` + deviceOf[email] + `"}` }

	var project struct{ Id string }
	if code := admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Chamadas"}`, &project); code != http.StatusCreated {
		t.Fatalf("project: %d", code)
	}
	base := "/api/v1/projects/" + project.Id
	for _, email := range emails[1:7] {
		if code := admin.do(http.MethodPost, base+"/members", `{"email":"`+email+`"}`, nil); code != http.StatusNoContent {
			t.Fatalf("add %s: %d", email, code)
		}
	}
	var channels []struct{ Id string }
	admin.do(http.MethodGet, base+"/conversations", "", &channels)
	channel := channels[0].Id
	startBody := func(conversation string, invitees ...string) string {
		quoted := make([]string, len(invitees))
		for i, id := range invitees {
			quoted[i] = `"` + id + `"`
		}
		return fmt.Sprintf(`{"conversationId":%q,"inviteeIds":[%s]}`, conversation, strings.Join(quoted, ","))
	}

	if code := login(unconfigured, emails[1]).do(http.MethodPost, "/api/v1/calls", startBody(channel), nil); code != http.StatusServiceUnavailable {
		t.Fatalf("calls without media server: %d", code)
	}
	if code := external.do(http.MethodPost, "/api/v1/calls", startBody(channel), nil); code != http.StatusForbidden {
		t.Fatalf("external without calls.start: %d", code)
	}
	if code := outsider.do(http.MethodPost, "/api/v1/calls", startBody(channel), nil); code != http.StatusNotFound {
		t.Fatalf("outsider start: %d", code)
	}
	if code := users[0].do(http.MethodPost, "/api/v1/calls", startBody(channel, ids[emails[0]], ids[emails[2]], ids[emails[3]], ids[emails[4]], ids[emails[5]], ids[emails[6]]), nil); code != http.StatusCreated {
		t.Fatalf("start with six invitees: %d", code)
	}
	if code := users[0].do(http.MethodPost, "/api/v1/calls", startBody(channel), nil); code != http.StatusConflict {
		t.Fatalf("second active call in the channel: %d", code)
	}
	var active []callDTO
	if code := users[1].do(http.MethodGet, "/api/v1/calls/active?conversationId="+channel, "", &active); code != http.StatusOK || len(active) != 1 || !active[0].InvitedMe {
		t.Fatalf("active call: %d %+v", code, active)
	}
	call := active[0]
	if code := outsider.do(http.MethodGet, "/api/v1/calls/"+call.Id, "", nil); code != http.StatusNotFound {
		t.Fatalf("outsider reads call: %d", code)
	}
	var pending []struct{ CallId string }
	if code := external.do(http.MethodGet, "/api/v1/call-invitations", "", &pending); code != http.StatusOK || len(pending) != 1 {
		t.Fatalf("external invitations: %d %+v", code, pending)
	}
	if code := outsider.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/join", `{"deviceId":"00000000-0000-4000-8000-000000000999"}`, nil); code != http.StatusNotFound {
		t.Fatalf("outsider join: %d", code)
	}

	// Six people try to take five seats at the same time.
	joiners := []*workClient{users[0], users[1], users[2], users[3], users[4], external}
	joinerEmails := []string{emails[1], emails[2], emails[3], emails[4], emails[5], emails[6]}
	var wg sync.WaitGroup
	results := make([]int, len(joiners))
	tickets := make([]ticketDTO, len(joiners))
	for i, person := range joiners {
		wg.Add(1)
		go func(i int, person *workClient) {
			defer wg.Done()
			var ticket ticketDTO
			results[i] = person.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/join", joinBody(joinerEmails[i]), &ticket)
			tickets[i] = ticket
		}(i, person)
	}
	wg.Wait()
	admitted, refused := 0, 0
	for i, code := range results {
		switch code {
		case http.StatusOK:
			admitted++
			if tickets[i].Token == "" || tickets[i].ReservedForSeconds != 30 {
				t.Fatalf("admitted without a usable ticket: %+v", tickets[i])
			}
		case http.StatusConflict:
			refused++
			if tickets[i].Token != "" {
				t.Fatal("a refused sixth person must not receive credentials")
			}
		default:
			t.Fatalf("unexpected join status %d", code)
		}
	}
	if admitted != 5 || refused != 1 {
		t.Fatalf("expected 5 admitted and 1 refused, got %d and %d", admitted, refused)
	}
	var seats int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM call_admission WHERE call_id = $1 AND state IN ('reserved','joined')`, call.Id).Scan(&seats); err != nil || seats != 5 {
		t.Fatalf("seats in the database: %d %v", seats, err)
	}
	// Tokens are scoped: parse one and check identity and room.
	for i, code := range results {
		if code != http.StatusOK {
			continue
		}
		verifier, parseErr := auth.ParseAPIToken(tickets[i].Token)
		if parseErr != nil {
			t.Fatal(parseErr)
		}
		_, grants, verifyErr := verifier.Verify(liveKitTestConfig.APISecret)
		if verifyErr != nil || verifier.Identity() != tickets[i].Identity || !strings.HasPrefix(grants.Video.Room, "call-") || grants.Video.RoomCreate {
			t.Fatalf("token scope: %v %+v", verifyErr, grants.Video)
		}
		break
	}
	// Who got in is decided by the race; the rest of the test follows the outcome.
	var internals []int
	refusedIndex := -1
	for i, code := range results {
		if code == http.StatusConflict {
			refusedIndex = i
		} else if joinerEmails[i] != emails[6] {
			internals = append(internals, i)
		}
	}
	if len(internals) < 4 {
		t.Fatalf("expected at least four admitted internal members, got %d", len(internals))
	}
	refusedPerson := joiners[refusedIndex]
	pick := func(n int) (*workClient, string) { return joiners[internals[n]], joinerEmails[internals[n]] }
	memberA, emailA := pick(0)
	memberB, emailB := pick(1)
	memberC, emailC := pick(2)
	memberD, emailD := pick(3)

	// Rejoining from the same session renews; another device must transfer.
	if code := memberB.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/join", joinBody(emailB), nil); code != http.StatusOK {
		t.Fatalf("same-session reconnect: %d", code)
	}
	secondDevice := login(handler, emailC)
	secondDeviceID := activate(secondDevice, emailC)
	secondBody := `{"deviceId":"` + secondDeviceID + `"}`
	if code := secondDevice.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/join", secondBody, nil); code != http.StatusConflict {
		t.Fatalf("second device without transfer: %d", code)
	}
	if code := secondDevice.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/join", `{"transfer":true,"deviceId":"`+secondDeviceID+`"}`, nil); code != http.StatusOK {
		t.Fatalf("second device with transfer: %d", code)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM call_admission WHERE call_id = $1 AND state IN ('reserved','joined')`, call.Id).Scan(&seats); err != nil || seats != 5 {
		t.Fatalf("transfer must not create a sixth seat: %d %v", seats, err)
	}

	// An admitted person cannot occupy a second call.
	var dm struct{ Id string }
	if code := memberB.do(http.MethodPost, "/api/v1/direct-conversations", `{"accountId":"`+ids[emailC]+`"}`, &dm); code != http.StatusCreated && code != http.StatusOK {
		t.Fatalf("dm: %d", code)
	}
	if code := memberB.do(http.MethodPost, "/api/v1/calls", startBody(dm.Id), nil); code != http.StatusCreated {
		t.Fatalf("dm call: %d", code)
	}
	memberB.do(http.MethodGet, "/api/v1/calls/active?conversationId="+dm.Id, "", &active)
	dmCall := active[0]
	if code := memberB.do(http.MethodPost, "/api/v1/calls/"+dmCall.Id+"/join", joinBody(emailB), nil); code != http.StatusConflict {
		t.Fatalf("second simultaneous call: %d", code)
	}
	if code := memberC.do(http.MethodPost, "/api/v1/calls/"+dmCall.Id+"/end", "", nil); code != http.StatusForbidden {
		t.Fatalf("the other person in a DM cannot end it for everyone: %d", code)
	}
	if code := memberB.do(http.MethodPost, "/api/v1/calls/"+dmCall.Id+"/end", "", nil); code != http.StatusNoContent {
		t.Fatalf("starter ends dm call: %d", code)
	}

	// Leaving frees a seat for the person who was refused; an expired reservation does too.
	if code := memberD.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/leave", "", nil); code != http.StatusNoContent {
		t.Fatalf("leave: %d", code)
	}
	if code := refusedPerson.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/join", joinBody(joinerEmails[refusedIndex]), nil); code != http.StatusOK {
		t.Fatalf("join after a seat was freed: %d", code)
	}
	if code := memberD.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/join", joinBody(emailD), nil); code != http.StatusConflict {
		t.Fatalf("seat is taken again: %d", code)
	}
	if _, err := pool.Exec(ctx, `UPDATE call_admission SET reserved_until = now() - interval '1 second' WHERE call_id = $1 AND account_id = $2 AND state = 'reserved'`, call.Id, ids[emailC]); err != nil {
		t.Fatal(err)
	}
	if code := memberD.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/join", joinBody(emailD), nil); code != http.StatusOK {
		t.Fatalf("an expired reservation frees its seat: %d", code)
	}

	// Screen sharing: single slot, permission required.
	if code := external.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/screen-share", "", nil); code != http.StatusForbidden {
		t.Fatalf("external screen share: %d", code)
	}
	var shareTicket ticketDTO
	if code := memberA.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/screen-share", "", &shareTicket); code != http.StatusOK {
		t.Fatalf("screen share: %d", code)
	}
	verifier, _ := auth.ParseAPIToken(shareTicket.Token)
	if _, grants, verifyErr := verifier.Verify(liveKitTestConfig.APISecret); verifyErr != nil || !strings.Contains(strings.Join(grants.Video.CanPublishSources, ","), "screen_share") {
		t.Fatalf("screen share token: %v %+v", verifyErr, grants)
	}
	// The permission is granted inside the room, so nobody has to disconnect
	// (leaving would end a call the sharer is alone in).
	var sharedRoom string
	if err := pool.QueryRow(ctx, `SELECT room_name FROM call WHERE id = $1`, call.Id).Scan(&sharedRoom); err != nil {
		t.Fatal(err)
	}
	if !rooms.MayShareScreen(sharedRoom, ids[emailA]) {
		t.Fatal("the presenter must be allowed to publish a screen in the room")
	}
	if code := memberB.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/screen-share", "", nil); code != http.StatusConflict {
		t.Fatalf("second presenter: %d", code)
	}
	if rooms.MayShareScreen(sharedRoom, ids[emailB]) {
		t.Fatal("a refused presenter must not get the permission")
	}
	if code := memberA.do(http.MethodDelete, "/api/v1/calls/"+call.Id+"/screen-share", "", nil); code != http.StatusNoContent {
		t.Fatalf("release: %d", code)
	}
	if rooms.MayShareScreen(sharedRoom, ids[emailA]) {
		t.Fatal("stopping must take the permission back")
	}
	if code := memberB.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/screen-share", "", nil); code != http.StatusOK {
		t.Fatalf("presenter switch: %d", code)
	}

	// Webhooks: signed, idempotent, and unknown connections are removed.
	var roomName string
	if err := pool.QueryRow(ctx, `SELECT room_name FROM call WHERE id = $1`, call.Id).Scan(&roomName); err != nil {
		t.Fatal(err)
	}
	sendWebhook := func(body string, key, secret string) int {
		sum := sha256.Sum256([]byte(body))
		token, signErr := auth.NewAccessToken(key, secret).SetSha256(base64.StdEncoding.EncodeToString(sum[:])).SetValidFor(time.Minute).ToJWT()
		if signErr != nil {
			t.Fatal(signErr)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/livekit", strings.NewReader(body))
		req.Header.Set("Authorization", token)
		req.Header.Set("Content-Type", "application/webhook+json")
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		return result.Code
	}
	runID := fmt.Sprint(time.Now().UnixNano())
	event := func(id, kind, identity string) string {
		return fmt.Sprintf(`{"event":%q,"id":%q,"room":{"name":%q},"participant":{"identity":%q}}`, kind, runID+id, roomName, identity)
	}
	if code := sendWebhook(event("e0", "participant_joined", ids[emails[1]]), liveKitTestConfig.APIKey, "another-secret-another-secret-123456"); code != http.StatusUnauthorized {
		t.Fatalf("forged webhook: %d", code)
	}
	if code := sendWebhook(event("e1", "participant_joined", ids[emailB]), liveKitTestConfig.APIKey, liveKitTestConfig.APISecret); code != http.StatusNoContent {
		t.Fatalf("webhook: %d", code)
	}
	var state string
	if err := pool.QueryRow(ctx, `SELECT state FROM call_admission WHERE call_id = $1 AND account_id = $2 AND state IN ('reserved','joined')`, call.Id, ids[emailB]).Scan(&state); err != nil || state != "joined" {
		t.Fatalf("participant_joined must mark the seat joined: %s %v", state, err)
	}
	rooms.Join(roomName, ids[emails[7]])
	if code := sendWebhook(event("e2", "participant_joined", ids[emails[7]]), liveKitTestConfig.APIKey, liveKitTestConfig.APISecret); code != http.StatusNoContent {
		t.Fatalf("webhook for an unadmitted person: %d", code)
	}
	if !contains(rooms.Removed, ids[emails[7]]) {
		t.Fatalf("an unadmitted connection (token reuse) must be removed: %v", rooms.Removed)
	}
	if code := sendWebhook(event("e2", "participant_joined", ids[emails[7]]), liveKitTestConfig.APIKey, liveKitTestConfig.APISecret); code != http.StatusNoContent {
		t.Fatalf("replayed webhook: %d", code)
	}

	// Reconciliation: a joined seat missing from the media server is freed.
	rooms.Join(roomName, ids[emailB])
	if _, err := pool.Exec(ctx, `UPDATE call_admission SET joined_at = now() - interval '5 minutes', state = 'joined' WHERE call_id = $1 AND account_id = $2 AND state IN ('reserved','joined')`, call.Id, ids[emailA]); err != nil {
		t.Fatal(err)
	}
	if err := calls.Reconcile(ctx, pool, rooms); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT state FROM call_admission WHERE call_id = $1 AND account_id = $2 ORDER BY created_at DESC LIMIT 1`, call.Id, ids[emailA]).Scan(&state); err != nil || state != "left" {
		t.Fatalf("seat absent from the media server must be freed: %s %v", state, err)
	}

	// Ending: only the initiator or a project manager; everything is released.
	nonStarter := memberB
	if emailB == emails[1] {
		nonStarter = memberD
	}
	if code := nonStarter.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/end", "", nil); code != http.StatusForbidden {
		t.Fatalf("participant ended the channel call: %d", code)
	}
	if code := admin.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/end", "", nil); code != http.StatusNoContent {
		t.Fatalf("manager ends: %d", code)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM call_admission WHERE call_id = $1 AND state IN ('reserved','joined')`, call.Id).Scan(&seats); err != nil || seats != 0 {
		t.Fatalf("seats after ending: %d %v", seats, err)
	}
	if _, stillThere := rooms.Rooms[roomName]; stillThere {
		t.Fatal("the media room must be deleted")
	}
	if code := memberB.do(http.MethodPost, "/api/v1/calls/"+call.Id+"/join", joinBody(emailB), nil); code != http.StatusConflict {
		t.Fatalf("join an ended call: %d", code)
	}
	if code := memberB.do(http.MethodPost, "/api/v1/calls", startBody(channel), nil); code != http.StatusCreated {
		t.Fatalf("a new call can start once the previous ended: %d", code)
	}
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
