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
	"github.com/so77id/nalanda/apps/server/internal/app/web/static"
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
	// Professors is the CRUD's handlers (issue #151 S5 onward).
	Professors *handler.Professors
	// Controls is the entrance-controls CRUD's handlers (issue #166,
	// WP-E). Landed together with the two other blocks above rather than
	// piecemeal so a request to /controls/new does not 404 while the row
	// exists.
	Controls *handler.Controls
	// AdminBank is the manual bank-refresh endpoint (issue #230). Small
	// enough to warrant its own handler struct rather than a method on
	// Controls: the CRUD lives inside the controls domain, the bank
	// refresh sits in an /admin/ namespace one layer up.
	AdminBank *handler.AdminBank
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
			// The URL prefix is spelled out here rather than lifted to a
			// shared constant: this router is the one place that decides the
			// URL space (paths[] guards depend on it), and the review.html
			// template writes the two vendored-file URLs as string literals
			// anyway — a Go-side constant would create a coupling the
			// template does not verify (`Never let a comment claim what the
			// suite does not verify`, apps/server/CLAUDE.md). The vendor
			// README's §"How it is served" is the third copy of the URL and
			// names this file; a rename touches all three.
			Method: http.MethodGet, Path: "/static/",
			Handler: http.StripPrefix("/static/", static.Handler()).ServeHTTP,
			Public:  true,
			Why: "vendored front-end assets (PDF.js today) — the review page loads pdf.mjs as an " +
				"ES module AFTER the professor has signed in, so the happy path carries a session " +
				"cookie. What Public defends is the stale-tab case: if the session expires while " +
				"the tab is open, gating the module would 302-redirect the import to the login " +
				"HTML the browser then refuses as JavaScript. Public keeps a stale tab's viewer " +
				"failing loudly (missing PDF) instead of silently (module-type error). ADR-0047 §3",
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
		// The CRUD, from S5 on. Gated by default (no Public), which the
		// TestEveryRouteIsGatedUnlessItSaysWhyNot guard walks — an anonymous
		// visitor is redirected to /login before the handler runs.
		//
		// / is claimed by Controls.Root since issue #166 (WP-E) supersedes
		// #151's /professors landing: with WP-E landed, controls are the
		// professor's primary activity, and the professors table is
		// reached from the nav.
		{
			Method: http.MethodGet, Path: "/",
			Handler: deps.Controls.Root,
		},
		// The entrance-controls CRUD (issue #166 WP-E). Gated by default.
		{
			Method: http.MethodGet, Path: handler.ControlsPath,
			Handler: deps.Controls.List,
		},
		{
			Method: http.MethodGet, Path: handler.ControlsNewPath,
			Handler: deps.Controls.New,
		},
		{
			Method: http.MethodPost, Path: handler.ControlsPath,
			Handler: deps.Controls.Create,
		},
		{
			Method: http.MethodGet, Path: handler.ControlDetailPath,
			Handler: deps.Controls.Detail,
		},
		{
			Method: http.MethodGet, Path: handler.ControlSujetPath,
			Handler: deps.Controls.SujetPDF,
		},
		{
			Method: http.MethodGet, Path: handler.ControlCorrigePath,
			Handler: deps.Controls.CorrigePDF,
		},
		{
			Method: http.MethodGet, Path: handler.ControlPoolJSONPath,
			Handler: deps.Controls.PoolJSON,
		},
		// WP-F: the upload target. Gated by default (no Public), CSRF
		// enforced because the method is POST.
		{
			Method: http.MethodPost, Path: handler.ControlScansPath,
			Handler: deps.Controls.UploadScan,
		},
		{
			Method: http.MethodPost, Path: handler.ControlReanalyzePath,
			Handler: deps.Controls.ReanalyzeScans,
		},
		{
			Method: http.MethodPost, Path: handler.ControlClosePath,
			Handler: deps.Controls.CloseCorrection,
		},
		// WP-F: the review page and its scanned-image endpoint.
		{
			Method: http.MethodGet, Path: handler.CopyReviewPath,
			Handler: deps.Controls.Review,
		},
		{
			Method: http.MethodPost, Path: handler.CopyReviewPath,
			Handler: deps.Controls.SaveReview,
		},
		{
			Method: http.MethodGet, Path: handler.CopyPageImage,
			Handler: deps.Controls.PageImage,
		},
		// Issue #190: the corrected PDF, served from the annotated_copy row.
		{
			Method: http.MethodGet, Path: handler.CopyAnnotatedPDF,
			Handler: deps.Controls.AnnotatedPDF,
		},
		// Issue #204: the uploaded scan batch, downloadable from the detail
		// page like the generated PDFs.
		{
			Method: http.MethodGet, Path: handler.ControlUploadPath,
			Handler: deps.Controls.UploadsPDF,
		},
		{
			Method: http.MethodGet, Path: handler.ProfessorsPath,
			Handler: deps.Professors.List,
		},
		{
			Method: http.MethodGet, Path: handler.ProfessorsNewPath,
			Handler: deps.Professors.New,
		},
		{
			Method: http.MethodPost, Path: handler.ProfessorsPath,
			Handler: deps.Professors.Create,
		},
		{
			Method: http.MethodGet, Path: handler.ProfessorEditPath,
			Handler: deps.Professors.Edit,
		},
		{
			Method: http.MethodPost, Path: handler.ProfessorUpdatePath,
			Handler: deps.Professors.Update,
		},
		{
			Method: http.MethodPost, Path: handler.ProfessorDeactivatePath,
			Handler: deps.Professors.Deactivate,
		},
		{
			Method: http.MethodPost, Path: handler.ProfessorReactivatePath,
			Handler: deps.Professors.Reactivate,
		},
		// Issue #230: the manual bank-refresh endpoint. Gated by default
		// (no Public), CSRF enforced because the method is POST.
		{
			Method: http.MethodPost, Path: handler.AdminBankRefreshPath,
			Handler: deps.AdminBank.Refresh,
		},
		// Issue #249: the "Refrescar" / "Cerrar aviso" button on the async
		// job banner. Gated by default (no Public), CSRF enforced
		// because the method is POST.
		{
			Method: http.MethodPost, Path: handler.JobDismissPath,
			Handler: deps.Controls.DismissJob,
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
	case deps.Professors == nil:
		panic("web.Router: no professors handlers")
	case deps.Controls == nil:
		panic("web.Router: no controls handlers")
	case deps.AdminBank == nil:
		panic("web.Router: no admin bank handler")
	case deps.Log == nil:
		panic("web.Router: no logger")
	}

	table := routes(deps)

	mux := http.NewServeMux()
	public := map[string]bool{}
	paths := map[string]bool{}
	for _, route := range table {
		pattern := route.Method + " " + muxPathFor(route.Path)
		mux.Handle(pattern, route.Handler)
		if route.Public {
			public[pattern] = true
		}
		// `paths` remembers every REGISTERED path under any method (the
		// BROWSER path, not the mux pattern). A request to a path that
		// appears here but under the wrong verb must reach the mux so it
		// can answer 405 with the Allow header set — from the mux's side a
		// 404 and a 405 both look like "pattern == ''", and turning the
		// second into a shell 404 would hide the "wrong verb" signal a
		// client relies on.
		paths[route.Path] = true
	}

	return deps.Gate.Resolve(gate(deps.Gate, mux, public, paths))
}

// gate decides, per request, what the matched route requires.
//
// It asks the mux which pattern it matched rather than trusting a table lookup:
// that is what makes the answer true of the server that is actually running.
func gate(auth *middleware.Auth, mux *http.ServeMux, public, paths map[string]bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, pattern := mux.Handler(r)

		// Nothing matched. Two cases from the mux's side both look the same,
		// and they have to be split before answering:
		//
		//   - The path exists under some other method. Then this is a 405,
		//     not a 404: the mux answers it with the Allow header set, which
		//     is what tells a client which verbs to try.
		//   - The path exists under no method at all. Then it is a real 404,
		//     and we render it THROUGH THE SHELL (AC-11) rather than letting
		//     Go answer "404 page not found\n" in plain text.
		//
		// A stranger is still not redirected to the login page in either
		// case: turning every typo into a sign-in prompt would hide which
		// paths exist behind a wall that is not protecting anything.
		if pattern == "" {
			if paths[r.URL.Path] {
				mux.ServeHTTP(w, r)
				return
			}
			renderNotFound(w, r)
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

// muxPathFor turns the BROWSER path a route carries into the mux pattern it
// registers under. `/` in the table means the exact index; net/http.ServeMux
// spells that `/{$}` since Go 1.22 — a bare `/` pattern is a SUBTREE that
// silently matches every path nothing else claims, so `GET /` swallows every
// 404 and 405 on the whole site (measured in this WP's S5 first pass: `GET
// /logout` came back 303 to /professors instead of 405). Every other path is
// left alone.
//
// The split is what lets Route.Path stay the URL a browser types, so the
// guards that walk the table (`TestEveryRouteIsGatedUnlessItSaysWhyNot`,
// `TestEveryStateChangingRouteVerifiesCSRF`) can build a real request from
// it, and `paths[]` — the set the gate consults to distinguish a real 404
// from a 405 — is keyed by that same browser path.
func muxPathFor(path string) string {
	if path == "/" {
		return "/{$}"
	}
	return path
}

// renderNotFound writes a 404 through the shell. The Spanish is not echoed
// back at the reader: what was asked for is deliberately dropped so that an
// attacker choosing the path cannot pick one that says something for them.
func renderNotFound(w http.ResponseWriter, r *http.Request) {
	middleware.WriteError(w, r, http.StatusNotFound, "Esta página no existe.")
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
