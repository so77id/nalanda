// Package web is the server-rendered delivery surface: the professor's
// backoffice.
//
// It has no screens yet. Templates, layout and the professor CRUD are WP-C3
// (#151), and authentication — which everything here will sit behind — is
// WP-C2 (#150). What exists today is the health endpoint, because a container
// health check has to have something to call.
package web

import (
	"log/slog"
	"net/http"

	"github.com/so77id/nalanda/apps/server/internal/domain/health"
	"github.com/so77id/nalanda/apps/server/internal/infra/httpjson"
)

// Router returns the surface's routes.
func Router(database health.Prober, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /health", healthHandler(database, logger))
	return mux
}

// healthHandler answers JSON rather than HTML, which is not an oversight: its
// readers today are `docker compose`, a future reverse proxy and a human with
// curl, none of whom want a page. It becomes HTML the day the backoffice has a
// layout to put it in, and not before — an empty template shell would be a
// directory that exists for its own sake.
func healthHandler(database health.Prober, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		report := health.Check(r.Context(), database)

		status := http.StatusOK
		if !report.Healthy() {
			status = http.StatusServiceUnavailable
		}
		httpjson.Write(w, logger, status, report)
	})
}
