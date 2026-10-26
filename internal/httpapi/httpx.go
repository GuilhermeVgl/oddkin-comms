package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"

	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// This file holds what every handler shares: answering, error reporting,
// transactions, body decoding and the UUID conversions between the generated
// API types and the database types.

func writeJSON(w http.ResponseWriter, status int, value any) {
	encoded, err := json.Marshal(value)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(encoded)
}

const defaultBodyLimit = 4096

func decodeJSONBody(w http.ResponseWriter, r *http.Request, payload any) bool {
	return decodeJSONBodyLimit(w, r, payload, defaultBodyLimit)
}

func decodeJSONBodyLimit(w http.ResponseWriter, r *http.Request, payload any, limit int64) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		w.WriteHeader(http.StatusBadRequest)
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		w.WriteHeader(http.StatusBadRequest)
		return false
	}
	return true
}

// serverError answers 503 for a failure the client cannot fix and records the
// cause for the operator. The cause is never sent to the client. Database
// errors are logged by SQLSTATE and constraint only: their detail may quote
// row values.
//
// Helpers that only hold the ResponseWriter pass a nil request; the log line
// then carries the request id but no route.
func serverError(w http.ResponseWriter, r *http.Request, err error) {
	ctx, route := context.Background(), ""
	if r != nil {
		ctx, route = r.Context(), r.Pattern
	}
	attrs := []any{"route", route, "request_id", w.Header().Get(requestIDHeader)}
	var pgErr *pgconn.PgError
	switch {
	case err == nil:
		attrs = append(attrs, "error", "unspecified")
	case errors.As(err, &pgErr):
		attrs = append(attrs, "error", "database", "sqlstate", pgErr.Code, "constraint", pgErr.ConstraintName, "table", pgErr.TableName)
	default:
		message := err.Error()
		if len(message) > 300 {
			message = message[:300]
		}
		attrs = append(attrs, "error", message)
	}
	slog.ErrorContext(ctx, "request failed", attrs...)
	w.WriteHeader(http.StatusServiceUnavailable)
}

// statusError ends a transaction with a plain HTTP status and no body.
type statusError int

func (s statusError) Error() string { return http.StatusText(int(s)) }

// errResponded means a helper has already written the response (for example
// loadAccess answering 404); the transaction rolls back and nothing more is sent.
var errResponded = errors.New("response already written")

// respondError turns the outcome of a transaction into a response. It returns
// true when the request is finished (an error was answered) and false on success,
// where the caller writes the result.
func respondError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errResponded) {
		return true
	}
	var status statusError
	if errors.As(err, &status) {
		w.WriteHeader(int(status))
		return true
	}
	serverError(w, r, err)
	return true
}

// inTx runs fn in one transaction: commit when it returns nil, rollback
// otherwise. Return statusError(code) to answer with a status, or errResponded
// after writing the response yourself; anything else becomes a logged 503.
func (h *apiServer) inTx(ctx context.Context, fn func(q *sqlc.Queries) error) error {
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err = fn(sqlc.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

// toPG converts an ID from the generated API types to the database type.
func toPG(id openapi_types.UUID) pgtype.UUID { return pgUUID(uuid.UUID(id)) }

// fromPG converts a database ID to the generated API type.
func fromPG(id pgtype.UUID) openapi_types.UUID { return openapi_types.UUID(uuid.UUID(id.Bytes)) }

// optionalUUID converts an optional API ID; nil becomes NULL.
func optionalUUID(id *openapi_types.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return toPG(*id)
}

// uuidPtr converts a database ID to an optional API ID; NULL becomes nil.
func uuidPtr(id pgtype.UUID) *openapi_types.UUID {
	if !id.Valid {
		return nil
	}
	value := fromPG(id)
	return &value
}

func isConstraintViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && (pgErr.Code == "23503" || pgErr.Code == "23514" || pgErr.Code == "23505")
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// uuidFrom unwraps a generated API ID into a plain google/uuid value.
func uuidFrom(id openapi_types.UUID) uuid.UUID { return uuid.UUID(id) }
