// An internal test package, unlike everywhere else in this module: rootHandler
// is unexported and lives in package main, which nothing can import. The
// alternative — moving the composition into internal/ — would put wiring
// somewhere other than cmd/server, which backend-code-style.md forbids.
package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/api"
	"github.com/so77id/nalanda/apps/server/internal/app/web"
	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/oauthstate"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
	"github.com/so77id/nalanda/apps/server/internal/domain/health"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker/amctest"
	"github.com/so77id/nalanda/apps/server/internal/infra/oidc/oidctest"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/controlstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

func emptyBank(t *testing.T) *bank.Bank {
	t.Helper()
	b, err := bank.Parse(strings.NewReader(`{"version":1,"documents":[],"questions":[]}`))
	if err != nil {
		t.Fatalf("emptyBank: %v", err)
	}
	return b
}

// composed builds the root handler the way run() does, so these cases exercise
// the composition rather than a rehearsal of it.
func composed(t *testing.T, prober health.Prober) (http.Handler, *authstore.Store) {
	t.Helper()

	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := storage.Migrate(ctx, db, migrations.FS); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	store := authstore.New(db)
	logger := testLogger()
	return rootHandler(web.Deps{
		Database: prober,
		Gate: middleware.NewAuth(middleware.Auth{
			Sessions: store, Users: store, Now: time.Now,
			PublicURL: "https://nalanda.test", LoginPath: handler.LoginPath, Log: logger,
		}),
		Login: handler.NewAuth(handler.Auth{
			Login: auth.NewLogin(auth.Login{
				Users: store, Identities: store, Sessions: store,
				Now: time.Now, SessionTTL: time.Hour,
			}),
			Provider:     &oidctest.Provider{},
			ProviderName: "google",
			State:        oauthstate.New(time.Minute, time.Now),
			PublicURL:    "https://nalanda.test",
			Log:          logger,
		}),
		Professors: handler.NewProfessors(handler.Professors{
			Users: store,
			Admin: auth.NewAdmin(auth.Admin{
				Users:    store,
				Sessions: store,
				Now:      time.Now,
			}),
			PublicURL: "https://nalanda.test",
			Log:       logger,
		}),
		Controls: handler.NewControls(handler.Controls{
			Service: controls.NewService(controls.Service{
				Bank:      emptyBank(t),
				Store:     controlstore.New(db),
				Generator: &amctest.Fake{},
				WorkDir:   t.TempDir(),
				Now:       time.Now,
				Seed:      1,
				Log:       logger,
			}),
			Bank:      emptyBank(t),
			PublicURL: "https://nalanda.test",
			Log:       logger,
		}),
		Log: logger,
	}, prober, logger), store
}

// signIn creates a professor with a live session and returns the cookie a
// browser would hold, plus the session's CSRF token.
func signIn(t *testing.T, store *authstore.Store) (*http.Cookie, string) {
	t.Helper()

	ctx := context.Background()
	user, err := store.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	token, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}
	csrf, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}
	now := time.Now()
	if err := store.CreateSession(ctx, auth.Session{
		TokenHash: auth.HashToken(token), UserID: user.ID, CSRFToken: csrf,
		CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastSeenAt: now,
	}); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return &http.Cookie{Name: middleware.SessionCookieName(true), Value: token}, csrf
}

type proberFunc func(context.Context) error

func (f proberFunc) Probe(ctx context.Context) error { return f(ctx) }

var (
	reachable   = proberFunc(func(context.Context) error { return nil })
	unreachable = proberFunc(func(context.Context) error { return errors.New("no such file or directory") })
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// The WP's headline deliverable: /health from BOTH surfaces, through the
// composition the binary actually serves. Each router has its own tests, but
// they prove nothing about main mounting them — deleting the /api/ mount left
// every one of those green while the built binary answered 404 (#149 review).
func TestBothSurfacesAnswerThroughTheComposedHandler(t *testing.T) {
	handler, _ := composed(t, reachable)

	for _, path := range []string{"/health", "/api/health"} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("GET %s = %d, want %d", path, rec.Code, http.StatusOK)
			}
			if body := rec.Body.String(); !strings.Contains(body, `"process":"up"`) {
				t.Errorf("GET %s body = %q, want a health report", path, body)
			}
		})
	}
}

// The database is shared, so an unreachable one must take BOTH surfaces down.
// A composition that handed one surface a different prober would pass the case
// above and fail here.
func TestBothSurfacesReportAnUnreachableDatabase(t *testing.T) {
	handler, _ := composed(t, unreachable)

	for _, path := range []string{"/health", "/api/health"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("GET %s = %d, want %d", path, rec.Code, http.StatusServiceUnavailable)
		}
	}
}

// The "/api/" prefix is an opinion held in two places: this file mounts it, and
// internal/app/api registers its routes with it already baked in. Nothing
// reconciles those, so a route registered in the api surface OUTSIDE the prefix
// compiles, passes its own package's tests, and is unreachable through the
// composition (#149 review, F3).
//
// This case pins the reconciliation from the outside: every route the API
// surface answers directly must also be answerable through the root handler.
func TestEveryApiRouteIsReachableThroughTheMount(t *testing.T) {
	root, _ := composed(t, reachable)

	// Grown by hand deliberately: ServeMux cannot enumerate its patterns, so a
	// new API route is added here too. The failure when it is not is loud and
	// immediate, which is the property the inline version did not have.
	apiRoutes := []string{"/api/health"}

	for _, path := range apiRoutes {
		direct := httptest.NewRecorder()
		api.Router(reachable, testLogger()).ServeHTTP(direct, httptest.NewRequest(http.MethodGet, path, nil))

		through := httptest.NewRecorder()
		root.ServeHTTP(through, httptest.NewRequest(http.MethodGet, path, nil))

		if direct.Code != through.Code {
			t.Errorf(
				"GET %s: the api surface answers %d directly but %d through the root mount.\n"+
					"A route registered outside the \"/api/\" prefix is unreachable in the binary.",
				path, direct.Code, through.Code,
			)
		}
		if through.Code == http.StatusNotFound {
			t.Errorf("GET %s is a 404 through the composition — it is registered but not mounted", path)
		}
	}

	if len(apiRoutes) == 0 {
		t.Fatal("apiRoutes is empty, so this test verified nothing")
	}
}

// The backoffice surface must not answer the API's paths through the
// composition, and vice versa — the mount order must not turn "/" into a
// catch-all that swallows "/api/".
func TestTheMountsDoNotSwallowEachOther(t *testing.T) {
	handler, _ := composed(t, reachable)

	// Registered by neither surface. It must 404, not be absorbed by "/".
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/nothing-here", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /api/nothing-here = %d, want 404", rec.Code)
	}

	// WP-C3 (#151, S5) claimed `/`: it is now the exact-match index of the
	// backoffice surface and redirects a signed-in professor to the CRUD
	// list. An anonymous request gets the gate's redirect to /login — which
	// is what asserts here — and the case still verifies that `/` is
	// EXACT: an accidental subtree pattern (`GET /`) would swallow every
	// unregistered path and make TestA404GoesThroughTheShell impossible.
	root := httptest.NewRecorder()
	handler.ServeHTTP(root, httptest.NewRequest(http.MethodGet, "/", nil))
	if root.Code != http.StatusSeeOther {
		t.Errorf("GET / = %d, want 303 (the gate redirects an anonymous request to /login)", root.Code)
	}
	if location := root.Header().Get("Location"); location != "/login" {
		// The literal, because the outer `handler` name in this scope is
		// the http.Handler returned by composed(); typing
		// handler.LoginPath here would be that variable and not the
		// package constant. Kept in sync with handler.LoginPath.
		t.Errorf("Location = %q, want %q", location, "/login")
	}

	// And an unregistered top-level path is a real 404, not swallowed by
	// the `/` route above.
	miss := httptest.NewRecorder()
	handler.ServeHTTP(miss, httptest.NewRequest(http.MethodGet, "/no-such-path", nil))
	if miss.Code != http.StatusNotFound {
		t.Errorf("GET /no-such-path = %d, want 404 — `/` must be exact-match, not a subtree", miss.Code)
	}
}

// §C12, asserted rather than promised: the two surfaces do not share an auth
// gate. The backoffice serves an authenticated professor; the API serves
// anonymous students who join a session with a room code.
//
// This is exactly the kind of rule that decays in silence. Mounting the session
// middleware one line higher — on the root mux instead of inside web.Router —
// compiles, passes every other test in this module, and quietly puts a login
// gate in front of every student. The only thing that notices is a case that
// asks the composed handler for an API route with no cookie at all.
func TestTheApiSurfaceIsReachableWithoutASession(t *testing.T) {
	root, _ := composed(t, reachable)

	rec := httptest.NewRecorder()
	root.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if rec.Code != http.StatusOK {
		t.Errorf("GET /api/health with no session = %d, want 200.\n"+
			"The API surface must not sit behind the professor gate (§C12): its callers are "+
			"anonymous students, and apps/web is a static site with no cookie to send.", rec.Code)
	}
	if rec.Header().Get("Set-Cookie") != "" {
		t.Errorf("the API surface set a cookie (%q); it has no session to keep",
			rec.Header().Get("Set-Cookie"))
	}
}

// The other half of the same seam: the backoffice's state-changing route IS
// gated through the composition. Without this, the case above would also pass on
// a binary with no gate anywhere.
//
// Asserted with a REAL session and no CSRF token, which is the only form of this
// case that can fail. The obvious version — POST with no session at all, expect
// a redirect — stays green when the gate is removed entirely, because the logout
// handler answers an anonymous request with a redirect of its own. Found by
// mutation.
func TestTheBackofficeGateIsMountedThroughTheComposition(t *testing.T) {
	root, store := composed(t, reachable)
	cookie, csrf := signIn(t, store)

	t.Run("a signed-in professor without the token is refused", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodPost, handler.LogoutPath, nil)
		request.AddCookie(cookie)

		rec := httptest.NewRecorder()
		root.ServeHTTP(rec, request)

		if rec.Code != http.StatusForbidden {
			t.Errorf("POST %s with a session and no CSRF token = %d, want 403 — "+
				"the CSRF middleware is not mounted", handler.LogoutPath, rec.Code)
		}
	})

	t.Run("with the token it goes through", func(t *testing.T) {
		form := url.Values{}
		form.Set(middleware.CSRFFieldName, csrf)
		request := httptest.NewRequest(http.MethodPost, handler.LogoutPath, strings.NewReader(form.Encode()))
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		request.AddCookie(cookie)

		rec := httptest.NewRecorder()
		root.ServeHTTP(rec, request)

		if rec.Code != http.StatusSeeOther {
			t.Errorf("POST %s with the session's own token = %d, want 303", handler.LogoutPath, rec.Code)
		}
	})

	t.Run("an anonymous request never reaches the handler", func(t *testing.T) {
		rec := httptest.NewRecorder()
		root.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, handler.LogoutPath, nil))

		// The gate redirects to the bare login path; the handler, if it ran,
		// would add its own "you have signed out" notice. The difference is what
		// tells the two apart.
		if location := rec.Header().Get("Location"); location != handler.LoginPath {
			t.Errorf("Location = %q, want %q — the logout handler ran instead of the gate",
				location, handler.LoginPath)
		}
	})
}

// And the API surface answers no route the backoffice owns. A login page served
// under /api/ would be a second, ungated way into the same handlers.
func TestTheApiSurfaceServesNoLoginRoutes(t *testing.T) {
	root, _ := composed(t, reachable)

	for _, path := range []string{
		"/api" + handler.LoginPath,
		"/api" + handler.LoginGooglePath,
		"/api" + handler.LoginCallbackPath,
		"/api" + handler.LogoutPath,
	} {
		rec := httptest.NewRecorder()
		root.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, rec.Code)
		}
	}
}
