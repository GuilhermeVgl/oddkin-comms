//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi"
	"github.com/GuilhermeVgl/oddkin-comms/internal/identity"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type wsFrame struct {
	Type       string `json:"type"`
	Cursor     string `json:"cursor"`
	EventType  string `json:"eventType"`
	ResourceID string `json:"resourceId"`
}

type socket struct {
	t    *testing.T
	conn *websocket.Conn
}

func dialEvents(t *testing.T, ctx context.Context, server *httptest.Server, client *workClient, cursor string) *socket {
	t.Helper()
	headers := http.Header{}
	headers.Set("Origin", server.URL)
	headers.Add("Cookie", client.session.String())
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/events/ws", &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	s := &socket{t: t, conn: conn}
	if hello := s.next(ctx); hello.Type != "hello" {
		t.Fatalf("expected hello, got %+v", hello)
	}
	if err := wsjson.Write(ctx, conn, map[string]string{"type": "resume", "cursor": cursor}); err != nil {
		t.Fatal(err)
	}
	return s
}

func (s *socket) next(ctx context.Context) wsFrame {
	s.t.Helper()
	readCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var frame wsFrame
	if err := wsjson.Read(readCtx, s.conn, &frame); err != nil {
		s.t.Fatalf("read frame: %v", err)
	}
	return frame
}

// expect reads frames until one of the wanted event types arrives.
func (s *socket) expect(ctx context.Context, want ...string) wsFrame {
	s.t.Helper()
	for i := 0; i < 20; i++ {
		frame := s.next(ctx)
		for _, kind := range want {
			if frame.EventType == kind {
				return frame
			}
		}
	}
	s.t.Fatalf("no %v event arrived", want)
	return wsFrame{}
}

func TestEventsNotificationsAndReadCursors(t *testing.T) {
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
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ('76000000-0000-4000-8000-000000000001', 'UTC') RETURNING id`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized LIKE 'evt-%@example.test'`)
	}()
	hash, err := identity.HashPassword("correct events password")
	if err != nil {
		t.Fatal(err)
	}
	queries := sqlc.New(pool)
	ids := map[string]string{}
	for _, email := range []string{"evt-admin@example.test", "evt-member@example.test", "evt-external@example.test", "evt-outsider@example.test"} {
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
	handler, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	login := func(email string) *workClient {
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/login", bytes.NewBufferString(`{"email":"`+email+`","password":"correct events password"}`))
		req.Header.Set("Origin", server.URL)
		req.Header.Set("Content-Type", "application/json")
		resp, doErr := http.DefaultClient.Do(req)
		if doErr != nil || resp.StatusCode != http.StatusNoContent {
			t.Fatalf("login %s: %v", email, doErr)
		}
		_ = resp.Body.Close()
		c := &workClient{t: t, handler: handler}
		for _, cookie := range resp.Cookies() {
			if cookie.Name == "oddkin_session" {
				c.session = cookie
			}
			if cookie.Name == "oddkin_csrf" {
				c.csrf = cookie
			}
		}
		return c
	}
	admin, member, external, outsider := login("evt-admin@example.test"), login("evt-member@example.test"), login("evt-external@example.test"), login("evt-outsider@example.test")

	var project struct{ Id string }
	if code := admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Eventos"}`, &project); code != http.StatusCreated {
		t.Fatalf("create project: %d", code)
	}
	base := "/api/v1/projects/" + project.Id
	for _, email := range []string{"evt-member@example.test", "evt-external@example.test"} {
		if code := admin.do(http.MethodPost, base+"/members", `{"email":"`+email+`"}`, nil); code != http.StatusNoContent {
			t.Fatalf("add %s: %d", email, code)
		}
	}
	var channels []struct {
		Id     string
		Unread int64
	}
	if code := member.do(http.MethodGet, base+"/conversations", "", &channels); code != http.StatusOK || len(channels) != 1 {
		t.Fatalf("channels: %d", code)
	}
	messagesPath := "/api/v1/conversations/" + channels[0].Id + "/messages"

	// Unauthenticated and cross-origin upgrades are refused.
	if resp, _ := http.Get(server.URL + "/api/v1/events/ws"); resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("ws without origin must be refused")
	}

	socketCtx, socketCancel := context.WithCancel(ctx)
	defer socketCancel()
	memberSocket := dialEvents(t, socketCtx, server, member, "")

	// Assignment produces a work-item event and a notification for the assignee only.
	var column struct{ Id, Category string }
	var columns []struct{ Id, Category string }
	admin.do(http.MethodGet, base+"/columns", "", &columns)
	column = columns[0]
	body := fmt.Sprintf(`{"kind":"task","title":"Para o membro","assigneeId":%q,"columnId":%q}`, ids["evt-member@example.test"], column.Id)
	if code := admin.do(http.MethodPost, base+"/work-items", body, nil); code != http.StatusCreated {
		t.Fatalf("assign: %d", code)
	}
	memberSocket.expect(socketCtx, "work-item.changed")
	memberSocket.expect(socketCtx, "notification.created")
	var notes []struct {
		Id, Kind string
		Read     bool
	}
	if code := member.do(http.MethodGet, "/api/v1/notifications", "", &notes); code != http.StatusOK || len(notes) != 1 || notes[0].Kind != "assignment" || notes[0].Read {
		t.Fatalf("notifications: %d %+v", code, notes)
	}
	if code := outsider.do(http.MethodGet, "/api/v1/notifications", "", &notes); code != http.StatusOK || len(notes) != 0 {
		t.Fatalf("outsider notifications: %d %+v", code, notes)
	}
	var mine []struct{ Id string }
	member.do(http.MethodGet, "/api/v1/notifications", "", &mine)
	if code := external.do(http.MethodPost, "/api/v1/notifications/"+mine[0].Id+"/read", "", nil); code != http.StatusNotFound {
		t.Fatalf("reading another person's notification: %d", code)
	}
	if code := member.do(http.MethodPost, "/api/v1/notifications/"+mine[0].Id+"/read", "", nil); code != http.StatusNoContent {
		t.Fatalf("mark read: %d", code)
	}

	// Messages: mention validation, unread counters and cursor-based resume.
	if code := admin.do(http.MethodPost, messagesPath, fmt.Sprintf(`{"body":"oi","clientMutationId":"00000000-0000-4000-8000-0000000003a0","mentionIds":[%q]}`, ids["evt-outsider@example.test"]), nil); code != http.StatusBadRequest {
		t.Fatalf("mention outside the project: %d", code)
	}
	if code := admin.do(http.MethodPost, messagesPath, fmt.Sprintf(`{"body":"olá @membro","clientMutationId":"00000000-0000-4000-8000-0000000003a1","mentionIds":[%q]}`, ids["evt-member@example.test"]), nil); code != http.StatusCreated {
		t.Fatalf("mention: %d", code)
	}
	last := memberSocket.expect(socketCtx, "message.created")
	memberSocket.expect(socketCtx, "notification.created")
	if code := member.do(http.MethodGet, base+"/conversations", "", &channels); code != http.StatusOK || channels[0].Unread != 1 {
		t.Fatalf("unread: %d %+v", code, channels)
	}
	if code := member.do(http.MethodPut, "/api/v1/conversations/"+channels[0].Id+"/read-cursor", `{"seq":99}`, nil); code != http.StatusNoContent {
		t.Fatalf("read cursor: %d", code)
	}
	member.do(http.MethodGet, base+"/conversations", "", &channels)
	if channels[0].Unread != 0 {
		t.Fatalf("unread after reading: %+v", channels)
	}
	if code := outsider.do(http.MethodPut, "/api/v1/conversations/"+channels[0].Id+"/read-cursor", `{"seq":1}`, nil); code != http.StatusNotFound {
		t.Fatalf("outsider read cursor: %d", code)
	}
	// The mention notification event is the newest; remember where we are, drop the socket.
	cursor := last.Cursor
	_ = memberSocket.conn.CloseNow()
	if code := admin.do(http.MethodPost, messagesPath, `{"body":"enquanto offline","clientMutationId":"00000000-0000-4000-8000-0000000003a2"}`, nil); code != http.StatusCreated {
		t.Fatalf("offline send: %d", code)
	}
	resumed := dialEvents(t, socketCtx, server, member, cursor)
	seenOffline := false
	for i := 0; i < 6 && !seenOffline; i++ {
		frame := resumed.next(socketCtx)
		seenOffline = frame.EventType == "message.created"
	}
	if !seenOffline {
		t.Fatal("resume lost the message sent while offline")
	}
	_ = resumed.conn.CloseNow()

	// A cursor minted for someone else, or forged, forces a snapshot.
	for name, forged := range map[string]string{"forged": "1.AAAA", "garbage": "x"} {
		sock := dialEvents(t, socketCtx, server, member, forged)
		if frame := sock.next(socketCtx); frame.Type != "sync_required" {
			t.Fatalf("%s cursor accepted: %+v", name, frame)
		}
	}
	extSocket := dialEvents(t, socketCtx, server, external, "")
	foreign := dialEvents(t, socketCtx, server, outsider, cursor)
	if frame := foreign.next(socketCtx); frame.Type != "sync_required" {
		t.Fatalf("another account's cursor accepted: %+v", frame)
	}

	// Delivery is re-authorized: once work.read is gone the external stops getting work events but keeps chat.
	if code := admin.do(http.MethodPut, base+"/external-policy", `{"version":1,"permissions":["chat.read","chat.send"]}`, nil); code != http.StatusOK {
		t.Fatalf("policy: %d", code)
	}
	if code := admin.do(http.MethodPost, base+"/work-items", `{"kind":"task","title":"Invisível ao externo"}`, nil); code != http.StatusCreated {
		t.Fatalf("create task: %d", code)
	}
	if code := admin.do(http.MethodPost, messagesPath, `{"body":"visível","clientMutationId":"00000000-0000-4000-8000-0000000003a3"}`, nil); code != http.StatusCreated {
		t.Fatalf("send: %d", code)
	}
	for i := 0; i < 20; i++ {
		frame := extSocket.next(socketCtx)
		if frame.EventType == "work-item.changed" {
			t.Fatalf("external received a work event without work.read: %+v", frame)
		}
		if frame.EventType == "message.created" {
			break
		}
		if i == 19 {
			t.Fatal("external did not receive the chat event")
		}
	}
	var raw json.RawMessage
	_ = raw
}
