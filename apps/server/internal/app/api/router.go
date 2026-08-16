// Package api is the JSON and WebSocket delivery surface, for anonymous
// students reached from apps/web.
//
// It exists now with almost nothing in it because C11 asks for the module
// boundary to be drawn before there is traffic across it, not after. There are
// no JSON contracts, no CORS and no WebSocket here yet: those arrive with a
// consumer (ADR-0008).
package api

import (
	"log/slog"
	"net/http"

	"github.com/so77id/nalanda/apps/server/internal/domain/health"
	"github.com/so77id/nalanda/apps/server/internal/infra/httpjson"
)

// Router returns the surface's routes, mounted at their full paths so that the
// binary's root mux is a plain composition of the two surfaces and no caller
// has to know a prefix.
func Router(database health.Prober, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	// The method is part of the pattern, which is what makes ServeMux answer
	// 405 rather than 404 for the right path with the wrong verb.
	mux.Handle("GET /api/health", healthHandler(database, logger))
	return mux
}

func healthHandler(database health.Prober, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		report := health.Check(r.Context(), database)

		// The status code is derived from the report and from nothing else. An
		// endpoint that answers 200 with a body saying "down" is read as
		// healthy by every orchestrator that has ever existed.
		status := http.StatusOK
		if !report.Healthy() {
			status = http.StatusServiceUnavailable
		}
		httpjson.Write(w, logger, status, report)
	})
}
