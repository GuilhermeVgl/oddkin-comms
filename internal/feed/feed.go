// Package feed writes domain events to per-user feeds. Callers run it inside
// the transaction that changed the data, so an event exists iff its change
// committed.
package feed

import (
	"context"
	"slices"
	"strings"

	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Spec describes one domain event fanned out to per-user feeds.
type Spec struct {
	Type           string
	ResourceID     pgtype.UUID
	Version        int32
	ProjectID      pgtype.UUID
	ConversationID pgtype.UUID
	Permission     string
}

// Emit writes the event to every recipient's feed. Recipients are locked in a
// deterministic order so that per-user sequences follow commit order without
// deadlocks.
func Emit(ctx context.Context, q *sqlc.Queries, recipients []pgtype.UUID, spec Spec) error {
	ordered := slices.Clone(recipients)
	slices.SortFunc(ordered, func(a, b pgtype.UUID) int { return strings.Compare(string(a.Bytes[:]), string(b.Bytes[:])) })
	ordered = slices.CompactFunc(ordered, func(a, b pgtype.UUID) bool { return a == b })
	eventID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	permission := pgtype.Text{String: spec.Permission, Valid: spec.Permission != ""}
	for _, recipient := range ordered {
		seq, err := q.NextUserEventSeq(ctx, recipient)
		if err != nil {
			return err
		}
		if err = q.InsertUserEvent(ctx, sqlc.InsertUserEventParams{
			AccountID: recipient, Seq: seq, EventID: eventID, Type: spec.Type, ResourceID: spec.ResourceID,
			ResourceVersion: spec.Version, ProjectID: spec.ProjectID, ConversationID: spec.ConversationID, RequiredPermission: permission,
		}); err != nil {
			return err
		}
	}
	return nil
}

// ProjectRecipients lists active project members holding permission ("" = any member).
func ProjectRecipients(ctx context.Context, q *sqlc.Queries, projectID pgtype.UUID, permission string) ([]pgtype.UUID, error) {
	return q.ProjectRecipients(ctx, sqlc.ProjectRecipientsParams{ProjectID: projectID, Permission: permission})
}

// ConversationRecipients lists everyone who may read a conversation.
func ConversationRecipients(ctx context.Context, q *sqlc.Queries, conversation sqlc.Conversation) ([]pgtype.UUID, error) {
	if conversation.Kind == "dm" {
		return []pgtype.UUID{conversation.DmLow, conversation.DmHigh}, nil
	}
	return ProjectRecipients(ctx, q, conversation.ProjectID, work.ChatRead)
}
