// Package web is the server-rendered delivery surface: the professor's
// backoffice.
//
// Since #150 it also holds the login round trip and the session gate. The
// screens themselves are still WP-C3 (#151); what exists today is /health,
// because a container healthcheck has to have something to call, and the four
// routes a professor needs to get in and out.
package web

import (
	"log/slog"
	"net/http"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
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

// Deps is what this surface is built from. A struct rather than a growing
// parameter list: #150 took the constructor from two arguments to four, and the
// next WP adds screens.
type Deps struct {
	Database health.Prober
	// Gate resolves the session cookie and guards what needs a professor. Named
	// for what it does, because the field that holds a *middleware.Auth sitting
	// beside the field that holds a *handler.Auth was one re-reading cost too
	// many (#150 review, ARQ-9).
	Gate *middleware.Auth
	// Login is the login round trip's handlers.
	Login *handler.Auth
	// Log is spelled the same here as in the two structs above.
	Log *slog.Logger
}

// Router returns the surface's routes.
//
// Resolve wraps EVERYTHING, and gates nothing: it only answers who is asking, so
// that the login page can greet a professor by name and /health can stay
// reachable without a cookie. What requires a professor says so route by route.
//
// That /health stays open is not an oversight to be tidied up later. The
// container healthcheck is the binary itself and carries no cookie, and CI
// probes the same path; putting the gate in front of it would produce a
// container that builds, starts, and is declared unhealthy forever.
func Router(deps Deps) http.Handler {
	// The gate redirects to the route THIS package registers, rather than to a
	// constant the middleware holds its own opinion about. Renaming
	// handler.LoginPath used to leave the suite green and the gate pointing at a
	// 404 (#150 review, ARQ-1).
	deps.Gate.LoginPath = handler.LoginPath

	mux := http.NewServeMux()

	mux.Handle("GET "+HealthPath, healthHandler(deps.Database, deps.Log))

	mux.HandleFunc("GET "+handler.LoginPath, deps.Login.LoginPage)
	mux.HandleFunc("GET "+handler.LoginGooglePath, deps.Login.LoginGoogle)
	mux.HandleFunc("GET "+handler.LoginCallbackPath, deps.Login.LoginGoogleCallback)

	// Logout is the first state-changing route, and the shape every later one
	// follows: a professor is required, and the request must carry the session's
	// own CSRF token.
	mux.Handle("POST "+handler.LogoutPath,
		deps.Gate.RequireProfessor(deps.Gate.VerifyCSRF(http.HandlerFunc(deps.Login.Logout))))

	return deps.Gate.Resolve(mux)
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
