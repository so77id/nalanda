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
// The routes are DATA rather than a sequence of mux calls, and that is the whole
// point: `Public` is a decision each route has to state, so adding one without
// deciding is a compile error rather than an omission, and the guard in
// router_test.go walks the same table the mux is built from — it cannot drift
// from what is actually served.
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
// What each route then requires is decided by its table entry — a professor
// unless it says why not, plus a CSRF token whenever the method changes state.
func Router(deps Deps) http.Handler {
	// The gate redirects to the route THIS package registers, rather than to a
	// constant the middleware holds its own opinion about. Renaming
	// handler.LoginPath used to leave the suite green and the gate pointing at a
	// 404 (#150 review, ARQ-1).
	deps.Gate.LoginPath = handler.LoginPath

	mux := http.NewServeMux()
	for _, route := range routes(deps) {
		mux.Handle(route.Method+" "+route.Path, wrap(deps.Gate, route))
	}
	return deps.Gate.Resolve(mux)
}

// wrap applies the middleware a route's own declaration asks for.
func wrap(gate *middleware.Auth, route Route) http.Handler {
	handler := http.Handler(route.Handler)
	if !isSafeMethod(route.Method) {
		// CSRF first from the inside, so the gate refuses an anonymous request
		// before the token is even looked for.
		handler = gate.VerifyCSRF(handler)
	}
	if !route.Public {
		handler = gate.RequireProfessor(handler)
	}
	return handler
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

// RoutesForTest exposes the table to this package's own guards.
//
// Exported rather than reached from inside the package because the guard has to
// drive the router through its public surface — a test that walked an internal
// list and called handlers directly would pass on a Router that never mounted
// them (#149 review, F7, one layer down).
func RoutesForTest(deps Deps) []Route { return routes(deps) }
