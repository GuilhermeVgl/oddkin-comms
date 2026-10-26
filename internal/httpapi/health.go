package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
)

type DatabaseProbe interface {
	Ping(context.Context) error
}

type apiServer struct {
	database DatabaseProbe
	auth     *authService
}

var _ gen.ServerInterface = (*apiServer)(nil)

func NewHandler(database DatabaseProbe) http.Handler {
	return withObservability(gen.Handler(&apiServer{database: database}), nil)
}

func (h *apiServer) GetLiveness(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiServer) GetReadiness(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := h.database.Ping(ctx); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
