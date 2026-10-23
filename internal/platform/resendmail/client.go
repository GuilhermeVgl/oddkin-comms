package resendmail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/identity"
)

const sendEndpoint = "https://api.resend.com/emails"
const sendTimeout = 10 * time.Second

var ErrInvalidConfig = errors.New("invalid Resend configuration")
var ErrInvalidMessage = errors.New("invalid transactional email")

type Message struct {
	To             string
	Subject        string
	Text           string
	IdempotencyKey string
}

// SendError deliberately omits the provider response, recipient, payload and API key.
type SendError struct {
	StatusCode int
	Retryable  bool
}

func (err *SendError) Error() string {
	if err.StatusCode == 0 {
		return "Resend transport unavailable"
	}
	return fmt.Sprintf("Resend returned HTTP %d", err.StatusCode)
}

type Client struct {
	apiKey   string
	from     string
	endpoint string
	http     *http.Client
}

func New(apiKey, from string) (*Client, error) {
	normalizedFrom, err := identity.NormalizeEmail(from)
	if !visibleASCII(apiKey, 512) || err != nil || normalizedFrom != from {
		return nil, ErrInvalidConfig
	}
	return &Client{
		apiKey:   apiKey,
		from:     from,
		endpoint: sendEndpoint,
		http: &http.Client{
			Timeout: sendTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

func (client *Client) Send(ctx context.Context, message Message) (id string, sendErr error) {
	normalizedTo, err := identity.NormalizeEmail(message.To)
	if err != nil || normalizedTo != message.To ||
		strings.TrimSpace(message.Subject) == "" || len(message.Subject) > 200 || strings.ContainsAny(message.Subject, "\r\n") ||
		strings.TrimSpace(message.Text) == "" || len(message.Text) > 16*1024 ||
		!visibleASCII(message.IdempotencyKey, 256) {
		return "", ErrInvalidMessage
	}
	payload, err := json.Marshal(struct {
		From    string   `json:"from"`
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		Text    string   `json:"text"`
	}{From: client.from, To: []string{message.To}, Subject: message.Subject, Text: message.Text})
	if err != nil {
		return "", ErrInvalidMessage
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", ErrInvalidMessage
	}
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", message.IdempotencyKey)
	request.Header.Set("User-Agent", "oddkin-comms/1")
	response, err := client.http.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", &SendError{Retryable: true}
	}
	defer func() {
		if closeErr := response.Body.Close(); closeErr != nil && sendErr == nil {
			id = ""
			sendErr = &SendError{Retryable: true}
		}
	}()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		retryable := response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500
		if response.StatusCode == http.StatusConflict {
			var providerError struct {
				Name string `json:"name"`
			}
			if json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&providerError) == nil {
				retryable = providerError.Name == "concurrent_idempotent_requests"
			}
		}
		return "", &SendError{StatusCode: response.StatusCode, Retryable: retryable}
	}
	var result struct {
		ID string `json:"id"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&result) != nil ||
		result.ID == "" || len(result.ID) > 128 || strings.ContainsAny(result.ID, "\r\n ") {
		return "", &SendError{Retryable: true}
	}
	return result.ID, nil
}

func visibleASCII(value string, maxLength int) bool {
	if len(value) == 0 || len(value) > maxLength {
		return false
	}
	for i := range len(value) {
		if value[i] < '!' || value[i] > '~' {
			return false
		}
	}
	return true
}
