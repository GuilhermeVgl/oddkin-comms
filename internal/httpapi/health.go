package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi/gen"
)

type DatabaseProbe interface {
	Ping(context.Context) error
}

type healthHandler struct {
	database DatabaseProbe
}

var _ gen.ServerInterface = (*healthHandler)(nil)

func NewHandler(database DatabaseProbe) http.Handler {
	return gen.Handler(&healthHandler{database: database})
}

func (h *healthHandler) GetLiveness(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func (h *healthHandler) GetReadiness(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := h.database.Ping(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
