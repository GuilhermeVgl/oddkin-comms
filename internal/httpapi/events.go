package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/feed"
	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

const (
	protocolVersion   = 1
	heartbeatInterval = 25 * time.Second
	pongTimeout       = 10 * time.Second
	feedPollInterval  = time.Second
	eventBatch        = 64
	sessionRecheck    = 30 * time.Second
)

type eventSpec = feed.Spec

func emitEvent(ctx context.Context, q *sqlc.Queries, recipients []pgtype.UUID, spec eventSpec) error {
	return feed.Emit(ctx, q, recipients, spec)
}

func projectRecipients(ctx context.Context, q *sqlc.Queries, projectID pgtype.UUID, permission string) ([]pgtype.UUID, error) {
	return feed.ProjectRecipients(ctx, q, projectID, permission)
}

func conversationRecipients(ctx context.Context, q *sqlc.Queries, conversation sqlc.Conversation) ([]pgtype.UUID, error) {
	return feed.ConversationRecipients(ctx, q, conversation)
}

// notifyAccount stores an in-app notification and announces it on the feed.
func notifyAccount(ctx context.Context, q *sqlc.Queries, recipient pgtype.UUID, kind string, resource, project, conversation pgtype.UUID) error {
	created, err := q.CreateNotification(ctx, sqlc.CreateNotificationParams{
		AccountID: recipient, Kind: kind, ResourceID: resource, ProjectID: project, ConversationID: conversation,
	})
	if err != nil {
		return err
	}
	return emitEvent(ctx, q, []pgtype.UUID{recipient}, eventSpec{Type: "notification.created", ResourceID: created.ID})
}

// canReceive re-validates, at delivery time, that the account may still see
// the context an event or notification refers to.
func canReceive(ctx context.Context, q *sqlc.Queries, accountID, projectID, conversationID pgtype.UUID, permission string) (bool, error) {
	if conversationID.Valid {
		conversation, err := q.GetConversation(ctx, conversationID)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if conversation.Kind == "dm" {
			if accountID != conversation.DmLow && accountID != conversation.DmHigh {
				return false, nil
			}
			return q.DirectMessagesAllowed(ctx, sqlc.DirectMessagesAllowedParams{First: conversation.DmLow, Second: conversation.DmHigh})
		}
		if permission == "" {
			permission = work.ChatRead
		}
		projectID = conversation.ProjectID
	}
	if !projectID.Valid {
		return true, nil
	}
	access, found, err := lookupAccess(ctx, q, projectID, accountID)
	if err != nil || !found {
		return false, err
	}
	return permission == "" || access.access.Can(permission), nil
}

func (h *chatAPI) ListNotifications(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	rows, err := q.ListNotifications(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	notifications := make([]gen.Notification, 0, len(rows))
	for _, row := range rows {
		permission := work.ChatRead
		if row.Kind == "assignment" || row.Kind == "followed_update" {
			permission = work.WorkRead
		}
		visible, authErr := canReceive(ctx, q, session.AccountID, row.ProjectID, row.ConversationID, permission)
		if authErr != nil {
			serverError(w, r, authErr)
			return
		}
		if !visible {
			continue
		}
		entry := gen.Notification{Id: fromPG(row.ID), Kind: gen.NotificationKind(row.Kind), ResourceId: fromPG(row.ResourceID), CreatedAt: row.CreatedAt.Time, Read: row.ReadAt.Valid}
		if row.ProjectID.Valid {
			project := fromPG(row.ProjectID)
			entry.ProjectId = &project
		}
		if row.ConversationID.Valid {
			conversation := fromPG(row.ConversationID)
			entry.ConversationId = &conversation
		}
		notifications = append(notifications, entry)
	}
	writeJSON(w, http.StatusOK, notifications)
}

func (h *chatAPI) MarkNotificationRead(w http.ResponseWriter, r *http.Request, notificationId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	changed, err := sqlc.New(h.auth.pool).MarkNotificationRead(ctx, sqlc.MarkNotificationReadParams{ID: toPG(notificationId), AccountID: session.AccountID})
	if err != nil {
		serverError(w, r, err)
		return
	}
	if changed == 0 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *chatAPI) MarkAllNotificationsRead(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := sqlc.New(h.auth.pool).MarkAllNotificationsRead(ctx, session.AccountID); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *chatAPI) SetReadCursor(w http.ResponseWriter, r *http.Request, conversationId openapi_types.UUID) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	var payload gen.ReadCursorRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	conversation, access, ok := conversationAccess(ctx, w, q, conversationId, session.AccountID)
	if !ok {
		return
	}
	if !access.read {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if err := q.SetReadCursor(ctx, sqlc.SetReadCursorParams{AccountID: session.AccountID, ConversationID: conversation.ID, Seq: payload.Seq}); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- cursor ---------------------------------------------------------------

func (s *authService) signCursor(account pgtype.UUID, seq int64) string {
	mac := hmac.New(sha256.New, s.cursorKey)
	_, _ = fmt.Fprintf(mac, "%x|%d", account.Bytes, seq)
	return strconv.FormatInt(seq, 10) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// parseCursor accepts only cursors minted for this account.
func (s *authService) parseCursor(account pgtype.UUID, cursor string) (int64, bool) {
	number, _, found := strings.Cut(cursor, ".")
	seq, err := strconv.ParseInt(number, 10, 64)
	if !found || err != nil || seq < 0 {
		return 0, false
	}
	return seq, hmac.Equal([]byte(cursor), []byte(s.signCursor(account, seq)))
}

// --- WebSocket ------------------------------------------------------------

type clientFrame struct {
	Type   string `json:"type"`
	Cursor string `json:"cursor"`
}

type serverFrame struct {
	Type            string `json:"type"`
	ProtocolVersion int    `json:"protocolVersion,omitempty"`
	HeartbeatSecs   int    `json:"heartbeatSeconds,omitempty"`
	RetentionDays   int    `json:"retentionDays,omitempty"`
	Cursor          string `json:"cursor,omitempty"`
	EventID         string `json:"eventId,omitempty"`
	EventType       string `json:"eventType,omitempty"`
	ResourceID      string `json:"resourceId,omitempty"`
	ContextID       string `json:"contextId,omitempty"`
	ResourceVersion int32  `json:"resourceVersion,omitempty"`
	OccurredAt      string `json:"occurredAt,omitempty"`
	Code            string `json:"code,omitempty"`
}

var errAuthNotConfigured = errors.New("auth service is not configured")

// frameWriter sends one frame to the client, bounded by a write deadline.
type frameWriter func(serverFrame) error

func (h *chatAPI) EventsSocket(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil {
		serverError(w, r, errAuthNotConfigured)
		return
	}
	if !sameOrigin(r) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	session, status := h.activeSession(r)
	if status != http.StatusOK {
		w.WriteHeader(status)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{r.Host}})
	if err != nil {
		return
	}
	defer func() { _ = conn.CloseNow() }()
	conn.SetReadLimit(16 << 10)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	write := frameWriter(func(frame serverFrame) error {
		writeCtx, writeCancel := context.WithTimeout(ctx, 10*time.Second)
		defer writeCancel()
		return wsjson.Write(writeCtx, conn, frame)
	})
	if err = write(serverFrame{Type: "hello", ProtocolVersion: protocolVersion, HeartbeatSecs: int(heartbeatInterval.Seconds()), RetentionDays: 7}); err != nil {
		return
	}

	frames := readClientFrames(ctx, cancel, conn)
	q := sqlc.New(h.auth.pool)
	last, resumed := h.awaitResume(ctx, conn, frames, q, session.AccountID, write)
	if !resumed {
		return
	}
	h.pumpFeed(ctx, r, conn, frames, q, session.AccountID, last, write)
}

// readClientFrames starts the single reader that owns the connection's read
// side; control frames flow through a bounded channel. The reader ends, and
// cancels the connection's context, when the connection or ctx closes.
func readClientFrames(ctx context.Context, cancel context.CancelFunc, conn *websocket.Conn) <-chan clientFrame {
	frames := make(chan clientFrame, 4)
	go func() {
		defer cancel()
		for {
			var frame clientFrame
			if readErr := wsjson.Read(ctx, conn, &frame); readErr != nil {
				return
			}
			select {
			case frames <- frame:
			case <-ctx.Done():
				return
			}
		}
	}()
	return frames
}

// awaitResume waits for the client's resume frame and returns the sequence
// to replay from. It closes the connection and reports false when the client
// misbehaves, times out or needs a fresh snapshot.
func (h *chatAPI) awaitResume(ctx context.Context, conn *websocket.Conn, frames <-chan clientFrame, q *sqlc.Queries, account pgtype.UUID, write frameWriter) (int64, bool) {
	select {
	case frame := <-frames:
		if frame.Type != "resume" {
			_ = conn.Close(websocket.StatusPolicyViolation, "resume expected")
			return 0, false
		}
		start, resumable := h.resumePoint(ctx, q, account, frame.Cursor)
		if !resumable {
			_ = write(serverFrame{Type: "sync_required"})
			_ = conn.Close(websocket.StatusNormalClosure, "sync required")
			return 0, false
		}
		return start, true
	case <-time.After(10 * time.Second):
		_ = conn.Close(websocket.StatusPolicyViolation, "resume timeout")
		return 0, false
	case <-ctx.Done():
		return 0, false
	}
}

// pumpFeed delivers the account's events from last on, pings the client, and
// re-checks the session, until the connection ends or the session does.
func (h *chatAPI) pumpFeed(ctx context.Context, r *http.Request, conn *websocket.Conn, frames <-chan clientFrame, q *sqlc.Queries, account pgtype.UUID, last int64, write frameWriter) {
	poll := time.NewTicker(feedPollInterval)
	defer poll.Stop()
	heartbeat := time.NewTicker(heartbeatInterval)
	defer heartbeat.Stop()
	recheck := time.NewTicker(sessionRecheck)
	defer recheck.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			pingCtx, pingCancel := context.WithTimeout(ctx, pongTimeout)
			pingErr := conn.Ping(pingCtx)
			pingCancel()
			if pingErr != nil {
				return
			}
		case <-recheck.C:
			if _, current := h.activeSession(r); current != http.StatusOK {
				_ = conn.Close(websocket.StatusPolicyViolation, "session ended")
				return
			}
		case frame := <-frames:
			if frame.Type != "ack" {
				_ = write(serverFrame{Type: "error", Code: "unsupported_frame"})
			}
		case <-poll.C:
			var err error
			if last, err = h.deliverEvents(ctx, q, account, last, write); err != nil {
				return
			}
		}
	}
}

// deliverEvents sends the next batch of events the account may still see and
// returns the sequence of the last event it looked at.
func (h *chatAPI) deliverEvents(ctx context.Context, q *sqlc.Queries, account pgtype.UUID, last int64, write frameWriter) (int64, error) {
	events, err := q.ListUserEvents(ctx, sqlc.ListUserEventsParams{AccountID: account, Seq: last, Limit: eventBatch})
	if err != nil {
		return last, err
	}
	for _, event := range events {
		last = event.Seq
		allowed, authErr := canReceive(ctx, q, account, event.ProjectID, event.ConversationID, event.RequiredPermission.String)
		if authErr != nil {
			return last, authErr
		}
		if !allowed {
			continue
		}
		if err = write(h.eventFrame(account, event)); err != nil {
			return last, err
		}
	}
	return last, nil
}

func (h *chatAPI) eventFrame(account pgtype.UUID, event sqlc.UserEvent) serverFrame {
	frame := serverFrame{
		Type: "event", Cursor: h.auth.signCursor(account, event.Seq), EventID: uuid.UUID(event.EventID.Bytes).String(),
		EventType: event.Type, ResourceID: uuid.UUID(event.ResourceID.Bytes).String(), ResourceVersion: event.ResourceVersion,
		OccurredAt: event.OccurredAt.Time.UTC().Format(time.RFC3339Nano),
	}
	if event.ConversationID.Valid {
		frame.ContextID = uuid.UUID(event.ConversationID.Bytes).String()
	} else if event.ProjectID.Valid {
		frame.ContextID = uuid.UUID(event.ProjectID.Bytes).String()
	}
	return frame
}

// resumePoint returns the sequence after which the feed is replayed. An empty
// cursor starts at the current head; a foreign, forged or expired cursor
// requires a fresh snapshot.
func (h *chatAPI) resumePoint(ctx context.Context, q *sqlc.Queries, account pgtype.UUID, cursor string) (int64, bool) {
	head, err := q.UserEventHead(ctx, account)
	if err != nil {
		return 0, false
	}
	if cursor == "" {
		return head, true
	}
	seq, valid := h.auth.parseCursor(account, cursor)
	if !valid || seq > head {
		return 0, false
	}
	oldest, err := q.OldestUserEventSeq(ctx, account)
	if err != nil || (seq < head && (oldest == 0 || seq+1 < oldest)) {
		return 0, false
	}
	return seq, true
}

// emitForMessage announces a change to a message to everyone who may read its conversation.
func emitForMessage(ctx context.Context, q *sqlc.Queries, eventType string, message sqlc.Message) error {
	conversation, err := q.GetConversation(ctx, message.ConversationID)
	if err != nil {
		return err
	}
	recipients, err := conversationRecipients(ctx, q, conversation)
	if err != nil {
		return err
	}
	return emitEvent(ctx, q, recipients, eventSpec{
		Type: eventType, ResourceID: message.ID, ProjectID: conversation.ProjectID, ConversationID: conversation.ID,
	})
}

func emitWorkItemChanged(ctx context.Context, q *sqlc.Queries, item sqlc.WorkItem) error {
	recipients, err := projectRecipients(ctx, q, item.ProjectID, work.WorkRead)
	if err != nil {
		return err
	}
	return emitEvent(ctx, q, recipients, eventSpec{
		Type: "work-item.changed", ResourceID: item.ID, Version: item.Version, ProjectID: item.ProjectID, Permission: work.WorkRead,
	})
}

func notifyAssignment(ctx context.Context, q *sqlc.Queries, item sqlc.WorkItem, actor pgtype.UUID, previous pgtype.UUID) error {
	if !item.AssigneeID.Valid || item.AssigneeID == actor || item.AssigneeID == previous {
		return nil
	}
	return notifyAccount(ctx, q, item.AssigneeID, "assignment", item.ID, item.ProjectID, pgtype.UUID{})
}

// notifyFollowers tells everyone following an activity, except the person who
// acted, that it changed. Someone who lost access to the project is skipped.
func notifyFollowers(ctx context.Context, q *sqlc.Queries, item sqlc.WorkItem, actor pgtype.UUID) error {
	followers, err := q.ListWorkItemFollowers(ctx, item.ID)
	if err != nil {
		return err
	}
	for _, follower := range followers {
		if follower == actor {
			continue
		}
		allowed, accessErr := canReceive(ctx, q, follower, item.ProjectID, pgtype.UUID{}, work.WorkRead)
		if accessErr != nil {
			return accessErr
		}
		if !allowed {
			continue
		}
		if err = notifyAccount(ctx, q, follower, "followed_update", item.ID, item.ProjectID, pgtype.UUID{}); err != nil {
			return err
		}
	}
	return nil
}
