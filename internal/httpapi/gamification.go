package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/GuilhermeVgl/crewstead-comms/internal/work"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxFocusMinutes = 180

// GetMyStats is the caller's own scoreboard. It is computed from operational
// metadata only (when work was finished, thanks, focus time, calls joined).
func (h *workAPI) GetMyStats(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	zone := time.UTC
	if name, err := q.GetOrganizationTimezone(ctx, session.AccountID); err == nil {
		if loaded, loadErr := time.LoadLocation(name); loadErr == nil {
			zone = loaded
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		serverError(w, r, err)
		return
	}
	rows, err := q.ListCompletionDays(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	counts, err := q.GetGamificationCounts(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	now := time.Now().In(zone)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	days := make([]time.Time, 0, len(rows))
	finishedToday := 0
	for _, row := range rows {
		days = append(days, row.Day.Time)
		if row.Day.Time.Equal(today) {
			finishedToday = int(row.Finished)
		}
	}
	current, best := work.Streaks(days, today)
	writeJSON(w, http.StatusOK, gen.MyStats{
		CompletedToday: finishedToday, CompletedTotal: int(counts.CompletedTotal), CurrentStreak: current, BestStreak: best,
		KudosReceived: int(counts.KudosReceived), KudosGiven: int(counts.KudosGiven), FocusMinutes: int(counts.FocusMinutes),
		CallsJoined: int(counts.CallsJoined), CommentsWritten: int(counts.CommentsWritten),
	})
}

func (h *workAPI) GetWorkItemEngagement(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	item, account, ok := h.followAccess(w, r, workItemId, false)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	row, err := sqlc.New(h.auth.pool).GetItemEngagement(ctx, sqlc.GetItemEngagementParams{Item: item.ID, Me: account})
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, gen.WorkItemEngagement{KudosCount: int(row.KudosCount), KudosMine: row.KudosMine, FocusMinutes: int(row.FocusMinutes)})
}

// GiveKudos thanks whoever finished an activity. The assignee hears about it
// once, however many times the same person presses the button.
func (h *workAPI) GiveKudos(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	err := h.inTx(ctx, func(q *sqlc.Queries) error {
		item, access, ok := h.workItemAccess(ctx, w, q, workItemId, session.AccountID)
		if !ok {
			return errResponded
		}
		switch {
		case !access.access.Can(work.WorkRead):
			return statusError(http.StatusForbidden)
		case item.AssigneeID == session.AccountID:
			return statusError(http.StatusForbidden)
		case !item.AssigneeID.Valid || !item.CompletedAt.Valid:
			return statusError(http.StatusConflict)
		}
		added, err := q.GiveKudos(ctx, sqlc.GiveKudosParams{WorkItemID: item.ID, FromAccountID: session.AccountID})
		if err != nil {
			return err
		}
		if added > 0 {
			return notifyAccount(ctx, q, item.AssigneeID, "kudos", item.ID, item.ProjectID, pgtype.UUID{})
		}
		return nil
	})
	if respondError(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *workAPI) RemoveKudos(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	item, account, ok := h.followAccess(w, r, workItemId, true)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := sqlc.New(h.auth.pool).RemoveKudos(ctx, sqlc.RemoveKudosParams{WorkItemID: item.ID, FromAccountID: account}); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *workAPI) RecordFocusSession(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	var payload gen.FocusSessionRequest
	if !decodeJSONBody(w, r, &payload) {
		return
	}
	if payload.Minutes < 1 || payload.Minutes > maxFocusMinutes {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	item, account, ok := h.followAccess(w, r, workItemId, true)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := sqlc.New(h.auth.pool).RecordFocusSession(ctx, sqlc.RecordFocusSessionParams{AccountID: account, WorkItemID: item.ID, Minutes: int32(payload.Minutes)}); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
