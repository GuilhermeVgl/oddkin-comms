//go:build integration

package integration

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi"
)

func TestReadinessWithPostgres(t *testing.T) {
	ctx, pool := openTestPool(t, 10*time.Second)
	handler := httpapi.NewHandler(pool)

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/health/ready", nil).WithContext(ctx))
	if response.Code != http.StatusNoContent {
		t.Fatalf("ready with reachable PostgreSQL: status=%d, want 204", response.Code)
	}

	pool.Close()
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/health/ready", nil).WithContext(ctx))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("ready with closed PostgreSQL pool: status=%d, want 503", response.Code)
	}
}
