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

// HealthPath is the route the container healthcheck calls.
//
// Exported so the literal exists once. It was written out in four places —
// this router, selfcheck's URL builder, the compose healthcheck and the CI
// probe — with nothing tying them together, so renaming the route here would
// have left the suite green and broken only the container (#149 review, A6).
// The two that are still strings live outside Go and are covered by the
// compose path in the pre-PR protocol.
const HealthPath = "/health"

// Router returns the surface's routes.
func Router(database health.Prober, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET "+HealthPath, healthHandler(database, logger))
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
