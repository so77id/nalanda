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

// Route is one entry of this surface's table.
//
// The routes are DATA rather than a sequence of mux calls, so `Public` is a
// decision each route has to state and say why. What enforces it is not this
// type but Router's outer gate: the table is the only thing that can put a
// pattern in the public set, and everything else the mux serves is gated
// whether or not its author remembered.
//
// The guards in router_test.go walk this table. That is narrower than it
// sounds and the comment used to overclaim it: they prove the table's routes
// behave, not that the mux holds nothing else. The fail-closed default is what
// covers the rest.
//
// It exists because the review found the instruction that produces the opposite.
// The guide said a GET "needs neither" middleware, which is true of CSRF and
// false of the gate; followed literally by WP-C3, whose screens are all GETs,
// it would have published a list of professors' addresses to anonymous visitors
// (#150 review, AGR-1 and ADR-6).
type Route struct {
	Method  string
	Path    string
	Handler http.HandlerFunc

	// Public means "no professor required", and every route that sets it needs
	// the Why beside it. There are exactly three, and each is public for a
	// reason that would survive being asked about.
	Public bool
	Why    string
}

// routes is what the surface serves. WP-C3 appends to it.
func routes(deps Deps) []Route {
	return []Route{
		{
			Method: http.MethodGet, Path: HealthPath,
			Handler: healthHandler(deps.Database, deps.Log).ServeHTTP,
			Public:  true,
			Why: "the container healthcheck is the binary itself and carries no cookie, " +
				"and CI probes the same path; behind the gate it would build, start and be unhealthy forever",
		},
		{
			Method: http.MethodGet, Path: handler.LoginPath,
			Handler: deps.Login.LoginPage,
			Public:  true,
			Why:     "it is the way in; gating the login page is a door locked from the inside",
		},
		{
			Method: http.MethodGet, Path: handler.LoginGooglePath,
			Handler: deps.Login.LoginGoogle,
			Public:  true,
			Why:     "same: it starts the flow that produces the session",
		},
		{
			Method: http.MethodGet, Path: handler.LoginCallbackPath,
			Handler: deps.Login.LoginGoogleCallback,
			Public:  true,
			Why:     "Google redirects the browser here before any session exists",
		},
		{
			Method: http.MethodPost, Path: handler.LogoutPath,
			Handler: deps.Login.Logout,
		},
	}
}

// Router returns the surface's routes.
//
// Resolve wraps EVERYTHING and gates nothing: it only answers who is asking.
// The gate is applied ONE LAYER OUT, against what the mux actually matched —
// not against the table entry — and that difference is the whole design.
//
// The first version wrapped each handler as it was registered. It was correct
// for every route in the table and worthless against the mistake the table
// exists to prevent: three separate review lenses each added
// `mux.HandleFunc("GET /professors", …)` beside the loop and served a
// professor's address to anonymous visitors with the entire suite green
// (#150 review, SEC-7 / COR-12 / ARQ-11). The guards walked the table; the mux
// served something else.
//
// Now the default is closed. A request is gated unless the pattern the mux
// matched was declared `Public` in the table, and CSRF is required whenever the
// METHOD changes state, whatever the route thought. A handler registered
// directly on the mux is therefore gated by construction — there is no way to
// be public except to appear in `routes()` and say why.
func Router(deps Deps) http.Handler {
	// Deps is the third struct of dependencies on this path and was the one
	// without a check: a nil Database panicked inside a request rather than at
	// boot, and a nil Login built a router that answered every login route with
	// a crash (#150 review, ARQ-3 residual). Wiring time is where this belongs.
	switch {
	case deps.Database == nil:
		panic("web.Router: no database prober")
	case deps.Gate == nil:
		panic("web.Router: no gate")
	case deps.Login == nil:
		panic("web.Router: no login handlers")
	case deps.Log == nil:
		panic("web.Router: no logger")
	}

	table := routes(deps)

	mux := http.NewServeMux()
	public := map[string]bool{}
	for _, route := range table {
		pattern := route.Method + " " + route.Path
		mux.Handle(pattern, route.Handler)
		if route.Public {
			public[pattern] = true
		}
	}

	return deps.Gate.Resolve(gate(deps.Gate, mux, public))
}

// gate decides, per request, what the matched route requires.
//
// It asks the mux which pattern it matched rather than trusting a table lookup:
// that is what makes the answer true of the server that is actually running.
func gate(auth *middleware.Auth, mux *http.ServeMux, public map[string]bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, pattern := mux.Handler(r)

		// Nothing matched: let the mux answer its own 404 rather than
		// redirecting a stranger to the login page, which would turn every typo
		// into a sign-in prompt and hide which paths exist behind a wall that
		// is not protecting anything.
		if pattern == "" {
			mux.ServeHTTP(w, r)
			return
		}

		handler := http.Handler(mux)
		if !isSafeMethod(r.Method) {
			// CSRF innermost, so the gate refuses an anonymous request before
			// the token is even looked for.
			handler = auth.VerifyCSRF(handler)
		}
		if !public[pattern] {
			handler = auth.RequireProfessor(handler)
		}
		handler.ServeHTTP(w, r)
	})
}

// isSafeMethod mirrors the middleware's own list. Duplicated deliberately and
// narrowly: this package decides which routes to WRAP, and importing a decision
// about HTTP semantics is cheaper than exporting one.
func isSafeMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
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
