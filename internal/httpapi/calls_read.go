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

func (h *apiServer) ListActiveCalls(w http.ResponseWriter, r *http.Request, params gen.ListActiveCallsParams) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	rights, ok := resolveCallRights(ctx, w, q, toPG(params.ConversationId), session.AccountID)
	if !ok {
		return
	}
	result := []gen.Call{}
	if rights.join {
		call, err := q.ActiveCallForConversation(ctx, rights.conversation.ID)
		if err == nil {
			built, buildErr := buildCall(ctx, q, call, rights, session.AccountID)
			if buildErr != nil {
				serverError(w, r, buildErr)
				return
			}
			result = append(result, built)
		} else if !errors.Is(err, pgx.ErrNoRows) {
			serverError(w, r, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *apiServer) ListCallInvitations(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	rows, err := q.ListPendingCallInvitations(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	result := []gen.CallInvitation{}
	for _, row := range rows {
		visible, authErr := canReceive(ctx, q, session.AccountID, pgtype.UUID{}, row.ConversationID, work.ChatRead)
		if authErr != nil {
			serverError(w, r, authErr)
			return
		}
		if visible {
			result = append(result, gen.CallInvitation{CallId: fromPG(row.CallID), ConversationId: fromPG(row.ConversationID), StartedBy: row.StartedByEmail, StartedById: uuidPtr(row.StartedBy), CreatedAt: row.CreatedAt.Time})
		}
	}
	writeJSON(w, http.StatusOK, result)
}

// ListCallHistory is the record of calls a conversation shows between its
// messages. Anyone who can read the conversation may see who took part.
func (h *apiServer) ListCallHistory(w http.ResponseWriter, r *http.Request, params gen.ListCallHistoryParams) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	rights, ok := resolveCallRights(ctx, w, q, toPG(params.ConversationId), session.AccountID)
	if !ok {
		return
	}
	limit := 30
	if params.Limit != nil {
		limit = *params.Limit
	}
	rows, err := q.ListCallRecords(ctx, sqlc.ListCallRecordsParams{ConversationID: rights.conversation.ID, Limit: int32(limit)})
	if err != nil {
		serverError(w, r, err)
		return
	}
	now := time.Now()
	result := make([]gen.CallRecord, 0, len(rows))
	for _, row := range rows {
		end := now
		record := gen.CallRecord{
			Id: fromPG(row.ID), State: gen.CallRecordState(row.State), StartedBy: row.StartedByEmail, StartedById: uuidPtr(row.StartedBy),
			StartedAt: row.CreatedAt.Time, Participants: row.ParticipantEmails, Answered: len(row.ParticipantEmails) >= 2,
		}
		if row.EndedAt.Valid {
			end = row.EndedAt.Time
			ended := row.EndedAt.Time
			record.EndedAt = &ended
		}
		if row.EndedReason.Valid {
			record.EndedReason = &row.EndedReason.String
		}
		record.DurationSeconds = max(0, int(end.Sub(row.CreatedAt.Time).Seconds()))
		result = append(result, record)
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *apiServer) GetCall(w http.ResponseWriter, r *http.Request, callId gen.CallId) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	call, rights, ok := loadCall(ctx, w, q, callId, session.AccountID, false)
	if !ok {
		return
	}
	if !rights.join {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	response, err := buildCall(ctx, q, call, rights, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}
