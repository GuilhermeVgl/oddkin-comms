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

// server holds what every group of handlers shares: the database probe and
// the authentication service (session, pool, media, storage and mail).
type server struct {
	database DatabaseProbe
	auth     *authService
}

// One type per area of the product. They all embed the shared server, so a
// helper defined on *server is available to every group, and a handler only
// reaches the helpers of its own group.
type (
	identityAPI struct{ *server } // sign-in, passwords, invitations, people, photos, branding, health
	workAPI     struct{ *server } // projects, activities, columns, epics, sprints, scoreboard
	chatAPI     struct{ *server } // channels, messages, the event feed
	filesAPI    struct{ *server } // attachments and their bodies
	keysAPI     struct{ *server } // E2EE key directory, devices, recovery
	callsAPI    struct{ *server } // calls, invitations, screen share, call keys
)

// apiServer is the whole HTTP API: the generated interface is satisfied by the
// methods the groups promote.
type apiServer struct {
	identityAPI
	workAPI
	chatAPI
	filesAPI
	keysAPI
	callsAPI
}

var _ gen.ServerInterface = (*apiServer)(nil)

func newAPIServer(shared *server) *apiServer {
	return &apiServer{
		identityAPI{shared}, workAPI{shared}, chatAPI{shared},
		filesAPI{shared}, keysAPI{shared}, callsAPI{shared},
	}
}

func NewHandler(database DatabaseProbe) http.Handler {
	return withObservability(gen.Handler(newAPIServer(&server{database: database})), nil)
}

func (h *identityAPI) GetLiveness(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func (h *identityAPI) GetReadiness(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := h.database.Ping(ctx); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
