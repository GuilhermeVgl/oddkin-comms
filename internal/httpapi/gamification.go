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
func (h *healthHandler) GetMyStats(w http.ResponseWriter, r *http.Request) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	rows, err := q.ListCompletionDays(ctx, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	counts, err := q.GetGamificationCounts(ctx, session.AccountID)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
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

func (h *healthHandler) GetWorkItemEngagement(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	item, account, ok := h.followAccess(w, r, workItemId, false)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	row, err := sqlc.New(h.auth.pool).GetItemEngagement(ctx, sqlc.GetItemEngagementParams{Item: item.ID, Me: account})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, gen.WorkItemEngagement{KudosCount: int(row.KudosCount), KudosMine: row.KudosMine, FocusMinutes: int(row.FocusMinutes)})
}

// GiveKudos thanks whoever finished an activity. The assignee hears about it
// once, however many times the same person presses the button.
func (h *healthHandler) GiveKudos(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	item, access, ok := h.workItemAccess(ctx, w, q, workItemId, session.AccountID)
	if !ok {
		return
	}
	switch {
	case !access.access.Can(work.WorkRead):
		w.WriteHeader(http.StatusForbidden)
		return
	case item.AssigneeID == session.AccountID:
		w.WriteHeader(http.StatusForbidden)
		return
	case !item.AssigneeID.Valid || !item.CompletedAt.Valid:
		w.WriteHeader(http.StatusConflict)
		return
	}
	added, err := q.GiveKudos(ctx, sqlc.GiveKudosParams{WorkItemID: item.ID, FromAccountID: session.AccountID})
	if err == nil && added > 0 {
		err = notifyAccount(ctx, q, item.AssigneeID, "kudos", item.ID, item.ProjectID, pgtype.UUID{})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *healthHandler) RemoveKudos(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
	item, account, ok := h.followAccess(w, r, workItemId, true)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := sqlc.New(h.auth.pool).RemoveKudos(ctx, sqlc.RemoveKudosParams{WorkItemID: item.ID, FromAccountID: account}); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *healthHandler) RecordFocusSession(w http.ResponseWriter, r *http.Request, workItemId gen.WorkItemId) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
