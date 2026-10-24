package calls

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/feed"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// ReservationSeconds is how long a seat is held for a client to connect.
	ReservationSeconds = 30
	// joinedGrace is how long a joined seat may be missing from the media
	// server before reconciliation frees it.
	joinedGrace = 45 * time.Second
	// emptyGrace is how long a call without any seat survives.
	emptyGrace = 2 * time.Minute
)

// Announce tells everyone who can read the conversation that the call changed.
func Announce(ctx context.Context, q *sqlc.Queries, call sqlc.Call) error {
	conversation, err := q.GetConversation(ctx, call.ConversationID)
	if err != nil {
		return err
	}
	recipients, err := feed.ConversationRecipients(ctx, q, conversation)
	if err != nil {
		return err
	}
	return feed.Emit(ctx, q, recipients, feed.Spec{
		Type: "call.changed", ResourceID: call.ID, ProjectID: conversation.ProjectID, ConversationID: conversation.ID,
	})
}

// End closes an active call inside the caller's transaction. It reports false
// when the call was already over. The media room is deleted by the caller after
// commit, never while holding database locks.
func End(ctx context.Context, q *sqlc.Queries, call sqlc.Call, reason string) (bool, error) {
	ended, err := q.EndCall(ctx, sqlc.EndCallParams{ID: call.ID, EndedReason: pgtype.Text{String: reason, Valid: true}})
	if err != nil || ended == 0 {
		return false, err
	}
	if err = q.ReleaseCallAdmissions(ctx, call.ID); err != nil {
		return false, err
	}
	if err = q.CancelPendingCallInvitations(ctx, call.ID); err != nil {
		return false, err
	}
	return true, Announce(ctx, q, call)
}

// ParticipantLeft frees a seat and ends the call when nobody is left.
func ParticipantLeft(ctx context.Context, q *sqlc.Queries, call sqlc.Call, account pgtype.UUID) (ended bool, err error) {
	changed, err := q.MarkParticipantLeft(ctx, sqlc.MarkParticipantLeftParams{CallID: call.ID, AccountID: account})
	if err != nil {
		return false, err
	}
	if call.ScreenSharerID == account {
		if err = q.ReleaseScreenShare(ctx, sqlc.ReleaseScreenShareParams{ID: call.ID, ScreenSharerID: account}); err != nil {
			return false, err
		}
	}
	if changed == 0 {
		return false, nil
	}
	seats, err := q.CountCallSeats(ctx, call.ID)
	if err != nil {
		return false, err
	}
	if seats == 0 {
		return End(ctx, q, call, "empty")
	}
	return false, Announce(ctx, q, call)
}

// ParticipantJoined records that the media server sees the account in the
// room. remove=true means the connection holds no valid seat (never admitted,
// already left, or the room is full) and must be disconnected.
func ParticipantJoined(ctx context.Context, q *sqlc.Queries, call sqlc.Call, account pgtype.UUID) (remove bool, err error) {
	if call.State != "active" {
		return true, nil
	}
	if err = q.ExpireStaleAdmissionsForCall(ctx, call.ID); err != nil {
		return false, err
	}
	latest, err := q.GetLatestAdmission(ctx, sqlc.GetLatestAdmissionParams{CallID: call.ID, AccountID: account})
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	switch latest.State {
	case "joined":
		return false, nil
	case "reserved":
	case "expired":
		seats, countErr := q.CountCallSeats(ctx, call.ID)
		if countErr != nil {
			return false, countErr
		}
		if seats >= MaxParticipants {
			return true, nil
		}
		// An expired seat may only be revived while the account holds no other.
		if active, activeErr := q.ActiveAdmissionForAccount(ctx, account); activeErr == nil && active.CallID != call.ID {
			return true, nil
		} else if activeErr != nil && !errors.Is(activeErr, pgx.ErrNoRows) {
			return false, activeErr
		}
	default:
		return true, nil
	}
	if _, err = q.MarkParticipantJoined(ctx, sqlc.MarkParticipantJoinedParams{CallID: call.ID, AccountID: account}); err != nil {
		return false, err
	}
	return false, Announce(ctx, q, call)
}

// Reconcile aligns the database with the media server. Webhooks can be late
// or lost, so this runs periodically as well.
func Reconcile(ctx context.Context, pool *pgxpool.Pool, rooms Rooms) error {
	calls, err := sqlc.New(pool).ListActiveCalls(ctx)
	if err != nil {
		return err
	}
	var failures int
	for _, call := range calls {
		if err := reconcileCall(ctx, pool, rooms, call); err != nil {
			failures++
		}
	}
	if failures > 0 {
		return fmt.Errorf("%d calls could not be reconciled", failures)
	}
	return nil
}

func reconcileCall(ctx context.Context, pool *pgxpool.Pool, rooms Rooms, call sqlc.Call) error {
	present, err := rooms.Participants(ctx, call.RoomName)
	if err != nil {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	locked, err := q.LockCall(ctx, call.ID)
	if err != nil || locked.State != "active" {
		return err
	}
	var kick []string
	seen := map[pgtype.UUID]bool{}
	for _, identity := range present {
		parsed, parseErr := uuid.Parse(identity)
		if parseErr != nil {
			kick = append(kick, identity)
			continue
		}
		account := pgtype.UUID{Bytes: parsed, Valid: true}
		remove, joinErr := ParticipantJoined(ctx, q, locked, account)
		if joinErr != nil {
			return joinErr
		}
		if remove {
			kick = append(kick, identity)
			continue
		}
		seen[account] = true
	}
	if err = q.ExpireStaleAdmissionsForCall(ctx, locked.ID); err != nil {
		return err
	}
	admissions, err := q.ListCallAdmissionsForReconcile(ctx, locked.ID)
	if err != nil {
		return err
	}
	for _, admission := range admissions {
		if admission.State == "joined" && !seen[admission.AccountID] && time.Since(admission.JoinedAt.Time) > joinedGrace {
			if _, err = ParticipantLeft(ctx, q, locked, admission.AccountID); err != nil {
				return err
			}
		}
	}
	seats, err := q.CountCallSeats(ctx, locked.ID)
	if err != nil {
		return err
	}
	deleteRoom := false
	if seats == 0 && time.Since(locked.CreatedAt.Time) > emptyGrace {
		if deleteRoom, err = End(ctx, q, locked, "empty"); err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	for _, identity := range kick {
		if removeErr := rooms.Remove(ctx, locked.RoomName, identity); removeErr != nil {
			return removeErr
		}
	}
	if deleteRoom {
		return rooms.DeleteRoom(ctx, locked.RoomName)
	}
	return nil
}
