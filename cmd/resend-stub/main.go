package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
)

type message struct {
	ID        string
	From      string
	To        string
	Subject   string
	Text      string
	CreatedAt time.Time
}

type inbox struct {
	mu       sync.RWMutex
	messages []message
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, logger); err != nil {
		logger.Error("local Resend stub stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, logger *slog.Logger) error {
	address := os.Getenv("HTTP_ADDR")
	if address == "" {
		address = ":8081"
	}
	server := &http.Server{
		Addr: address, Handler: newInboxHandler(), ReadHeaderTimeout: 5 * time.Second, MaxHeaderBytes: 1 << 20,
	}
	errorsChannel := make(chan error, 1)
	go func() { errorsChannel <- server.ListenAndServe() }()
	logger.Info("local Resend stub listening", "address", address)
	select {
	case err := <-errorsChannel:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
}

func newInboxHandler() http.Handler {
	box := &inbox{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /emails", box.receive)
	mux.HandleFunc("GET /", box.render)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	return mux
}

func (box *inbox) receive(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || r.Header.Get("Idempotency-Key") == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	var payload struct {
		From    string   `json:"from"`
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		Text    string   `json:"text"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024))
	if err := decoder.Decode(&payload); err != nil || payload.From == "" || len(payload.To) != 1 || payload.Subject == "" || payload.Text == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	id := fmt.Sprintf("local-%d", time.Now().UnixNano())
	box.mu.Lock()
	box.messages = append([]message{{
		ID: id, From: payload.From, To: payload.To[0], Subject: payload.Subject, Text: payload.Text, CreatedAt: time.Now(),
	}}, box.messages...)
	if len(box.messages) > 100 {
		box.messages = box.messages[:100]
	}
	box.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"id": id})
}

func (box *inbox) render(w http.ResponseWriter, _ *http.Request) {
	box.mu.RLock()
	messages := append([]message(nil), box.messages...)
	box.mu.RUnlock()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = inboxTemplate.Execute(w, messages)
}

var inboxTemplate = template.Must(template.New("inbox").Parse(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ODDKIN · E-mails locais</title>
<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:48px auto;padding:0 24px;background:#f8f4e9;color:#173124}h1{font-size:2.5rem}article{border-top:1px solid #aeb8ae;padding:24px 0}pre{white-space:pre-wrap;background:#fffdf7;padding:18px;overflow-wrap:anywhere}.empty{color:#66736b}</style></head>
<body><h1>E-mails locais do ODDKIN</h1>{{if .}}{{range .}}<article><strong>{{.Subject}}</strong><p>Para: {{.To}}</p><pre>{{.Text}}</pre></article>{{end}}{{else}}<p class="empty">Nenhum e-mail recebido ainda.</p>{{end}}</body></html>`))
