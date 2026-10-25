package httpapi

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"time"
)

const requestIDHeader = "X-Request-Id"

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{8,64}$`)

type recordingWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *recordingWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *recordingWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	written, err := w.ResponseWriter.Write(data)
	w.bytes += int64(written)
	return written, err
}

// Unwrap lets http.ResponseController reach the real writer (flush, deadlines).
func (w *recordingWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// Hijack keeps WebSocket upgrades working through the wrapper.
func (w *recordingWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, rw, err := http.NewResponseController(w.ResponseWriter).Hijack()
	if err == nil && w.status == 0 {
		w.status = http.StatusSwitchingProtocols
	}
	return conn, rw, err
}

// withObservability gives every request a correlation id (echoed in the
// response so a user can quote it) and, when a logger is given, writes one
// structured line per request. The line carries the route pattern, status and
// duration: never the path parameters, query string, headers or bodies, which
// may hold identifiers, tokens or content.
func withObservability(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(requestIDHeader)
		if !validRequestID.MatchString(id) {
			var entropy [12]byte
			_, _ = rand.Read(entropy[:])
			id = hex.EncodeToString(entropy[:])
		}
		w.Header().Set(requestIDHeader, id)
		recorder := &recordingWriter{ResponseWriter: w}
		started := time.Now()
		next.ServeHTTP(recorder, r)
		if logger == nil || r.URL.Path == "/api/v1/health/live" || r.URL.Path == "/api/v1/health/ready" {
			return
		}
		route := r.Pattern
		if route == "" {
			route = "unmatched"
		}
		status := recorder.status
		if status == 0 {
			status = http.StatusOK
		}
		level := slog.LevelInfo
		if status >= 500 {
			level = slog.LevelError
		}
		logger.Log(r.Context(), level, "request", "request_id", id, "route", route, "status", status,
			"duration_ms", time.Since(started).Milliseconds(), "bytes", recorder.bytes)
	})
}
