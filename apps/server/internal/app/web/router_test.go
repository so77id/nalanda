package web_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

// emptyBank returns a LiveBank wrapping a valid, empty bank for the router
// tests — the existing cases do not exercise controls flow, but the
// handler and service constructors refuse a nil bank. NewStaticLive is
// the test seam bank added for issue #230; production wiring goes through
// bank.NewLive.
func emptyBank(t *testing.T) *bank.LiveBank {
	t.Helper()
	b, err := bank.Parse(strings.NewReader(`{"version":1,"documents":[],"questions":[]}`))
	if err != nil {
		t.Fatalf("emptyBank: %v", err)
	}
	return bank.NewStaticLive(b)
}

// deps builds the surface the way cmd/server does, over a real (empty) database.
// The auth chain is real rather than stubbed because half of what these cases
// assert is which routes the middleware lets past.
func deps(t *testing.T, prober health.Prober) web.Deps {
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
	return web.Deps{
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
			Service: func() *controls.Service {
				cstore := controlstore.New(db)
				fake := &amctest.Fake{}
				return controls.NewService(controls.Service{
					Bank:            emptyBank(t),
					Store:           cstore,
					Generator:       fake,
					Analyzer:        fake,
					Readings:        cstore,
					Annotator:       fake,
					AnnotateEnabled: true,
					WorkDir:         t.TempDir(),
					Now:             time.Now,
					Seed:            1,
					Log:             logger,
				})
			}(),
			Bank:               emptyBank(t),
			PublicURL:          "https://nalanda.test",
			OnCorrectionClosed: controls.NewNoopHook(logger),
			Log:                logger,
		}),
		Log: logger,
	}
}

type proberFunc func(context.Context) error

func (f proberFunc) Probe(ctx context.Context) error { return f(ctx) }

var (
	reachable   = proberFunc(func(context.Context) error { return nil })
	unreachable = proberFunc(func(context.Context) error { return errors.New("no such file or directory") })
)

func TestHealthIs200WhenTheDatabaseAnswers(t *testing.T) {
	rec := httptest.NewRecorder()
	web.Router(deps(t, reachable)).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); !strings.Contains(body, "up") {
		t.Errorf("body = %q, want it to report the components", body)
	}
}

// AC-2 and AC-3 both land here: this is the path a human and a container
// health check actually call.
func TestHealthIs503WhenTheDatabaseIsUnreachable(t *testing.T) {
	rec := httptest.NewRecorder()
	web.Router(deps(t, unreachable)).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	if body := rec.Body.String(); !strings.Contains(body, "down") {
		t.Errorf("body = %q, want it to name the component that is down", body)
	}
}

func TestHealthRejectsANonGetMethod(t *testing.T) {
	rec := httptest.NewRecorder()
	web.Router(deps(t, reachable)).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/health", nil))

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

// The 404 rendered by the shell — AC-11. The default Go text "404 page not
// found\n" is what an operator got before this WP; from S2 on the response is
// an HTML page carrying the shell markers, whatever the caller's session
// state.
func TestA404GoesThroughTheShell(t *testing.T) {
	rec := httptest.NewRecorder()
	web.Router(deps(t, reachable)).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/no-such-path", nil))

	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /no-such-path = %d, want 404", rec.Code)
	}
	body := rec.Body.String()
	if strings.HasPrefix(body, "404 page not found") {
		t.Errorf("body is Go's default 404 text; the shell did not take over:\n%s", body)
	}
	for _, want := range []string{"<!doctype html>", "color-scheme: light dark"} {
		if !strings.Contains(body, want) {
			t.Errorf("404 body missing %q\n---\n%s", want, body)
		}
	}
}

// The login round trip is mounted, and reachable without a cookie — which is
// what makes it a way IN rather than a page only a signed-in professor can see.
func TestTheLoginRoutesAreMountedAndOpen(t *testing.T) {
	router := web.Router(deps(t, reachable))

	for _, c := range []struct {
		path string
		want int
	}{
		{handler.LoginPath, http.StatusOK},
		// The other two redirect: one to the provider, one back to the login
		// page, since a callback with no state is refused.
		{handler.LoginGooglePath, http.StatusSeeOther},
		{handler.LoginCallbackPath, http.StatusSeeOther},
	} {
		t.Run(c.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, c.path, nil))

			if rec.Code != c.want {
				t.Errorf("GET %s = %d, want %d", c.path, rec.Code, c.want)
			}
		})
	}
}

// /health carries no cookie — the container healthcheck is the binary itself and
// CI probes the same path — so a gate in front of it produces a container that
// builds, starts, and is unhealthy forever. Asserted here because the mistake is
// one line in Router and nothing else in the suite would see it.
func TestHealthNeedsNoSession(t *testing.T) {
	rec := httptest.NewRecorder()
	web.Router(deps(t, reachable)).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, web.HealthPath, nil))

	if rec.Code != http.StatusOK {
		t.Errorf("GET %s without a session = %d, want 200", web.HealthPath, rec.Code)
	}
}

// And the one state-changing route IS gated, both ways: no professor, and no
// CSRF token.
func TestLogoutIsGated(t *testing.T) {
	router := web.Router(deps(t, reachable))

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, handler.LogoutPath, nil))
	// The DESTINATION is the assertion, not the status. The logout handler also
	// answers an anonymous request with a 303, so a status check alone stays
	// green with the gate removed; only the gate redirects to the bare login
	// path, without the handler's own "you have signed out" notice.
	if location := rec.Header().Get("Location"); location != handler.LoginPath {
		t.Errorf("POST %s with no session redirected to %q, want %q — the gate is not mounted",
			handler.LogoutPath, location, handler.LoginPath)
	}

	// A GET is not a way around it either: the route is registered for POST.
	get := httptest.NewRecorder()
	router.ServeHTTP(get, httptest.NewRequest(http.MethodGet, handler.LogoutPath, nil))
	if get.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET %s = %d, want 405 — a logout reachable by GET is one any image tag performs",
			handler.LogoutPath, get.Code)
	}
}

// testLogger discards output: these cases are about status codes and bodies,
// and a logger writing to the test's stderr only makes a failure harder to read.
func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// The other half of the asymmetry api/router_test.go asserts: the backoffice
// surface KEEPS the diagnostic, because its reader is an operator and the
// alternative is making them open the logs to learn what a 503 meant.
func TestHealthKeepsTheCauseOnTheBackofficeSurface(t *testing.T) {
	rec := httptest.NewRecorder()
	web.Router(deps(t, unreachable)).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if body := rec.Body.String(); !strings.Contains(body, "no such file or directory") {
		t.Errorf("body = %q, want it to carry the prober's own message", body)
	}
}

// signInAgainst creates a professor with a live session in the database the deps
// were built over, and returns the cookie a browser would hold.
func signInAgainst(t *testing.T, d web.Deps) *http.Cookie {
	t.Helper()

	ctx := context.Background()
	store := d.Gate.Users.(*authstore.Store)

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
	return &http.Cookie{Name: middleware.SessionCookieName(true), Value: token}
}

// ARQ-1. The gate redirects somewhere, and nothing used to check that the
// somewhere is a route this router registers: the middleware held its own
// constant, so renaming handler.LoginPath left the suite green while every
// gated request landed on a 404.
//
// This is the reconciliation, in the one package that imports both — the same
// shape #149 needed for HealthPath and for the "/api/" mount.
func TestTheGateRedirectsToARouteThisRouterServes(t *testing.T) {
	router := web.Router(deps(t, reachable))

	gated := httptest.NewRecorder()
	router.ServeHTTP(gated, httptest.NewRequest(http.MethodPost, handler.LogoutPath, nil))

	target := gated.Header().Get("Location")
	if target == "" {
		t.Fatal("the gate issued no redirect")
	}

	landing := httptest.NewRecorder()
	router.ServeHTTP(landing, httptest.NewRequest(http.MethodGet, target, nil))

	if landing.Code == http.StatusNotFound {
		t.Errorf("the gate sends an anonymous request to %q, which this router answers with 404", target)
	}
}

// AGR-1 / ADR-6, the guard both lenses asked for. It walks the table the mux is
// actually built from, so it cannot describe a different server than the one
// that runs.
//
// The failure it exists to prevent: WP-C3's screens are all GETs, and the
// guide's rule for GETs was "needs neither middleware" — which is right about
// CSRF and wrong about the gate. A `GET /professors` mounted bare would have
// served a list of professors' addresses to anonymous visitors, and no test in
// this module could have seen it.
func TestEveryRouteIsGatedUnlessItSaysWhyNot(t *testing.T) {
	d := deps(t, reachable)
	router := web.Router(d)

	var checked, public int
	for _, route := range web.RoutesForTest(d) {
		checked++
		if route.Public {
			public++
			// A public route states its reason, and a human reads it at review
			// time — so the test insists there is one rather than judging it.
			if route.Why == "" {
				t.Errorf("%s %s is public and says nothing about why", route.Method, route.Path)
			}
			continue
		}

		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(route.Method, route.Path, nil))

		if recorder.Code != http.StatusSeeOther {
			t.Errorf("%s %s answered %d without a session, want a redirect to the login page — "+
				"a route that is not Public must sit behind the gate",
				route.Method, route.Path, recorder.Code)
		}
		if location := recorder.Header().Get("Location"); location != handler.LoginPath {
			t.Errorf("%s %s redirected to %q, want %q", route.Method, route.Path, location, handler.LoginPath)
		}
	}

	if checked == 0 {
		t.Fatal("the table is empty, so this test verified nothing")
	}
	if public == checked {
		t.Fatal("every route is public, so the gated half of this test verified nothing")
	}
}

// And the other axis: a state-changing route carries CSRF, whatever else it
// carries. Asserted with a real session, because without one the gate answers
// first and the 403 never comes from the check under test.
func TestEveryStateChangingRouteVerifiesCSRF(t *testing.T) {
	d := deps(t, reachable)
	router := web.Router(d)
	cookie := signInAgainst(t, d)

	var checked int
	for _, route := range web.RoutesForTest(d) {
		switch route.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			continue
		}
		checked++

		request := httptest.NewRequest(route.Method, route.Path, nil)
		request.AddCookie(cookie)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusForbidden {
			t.Errorf("%s %s answered %d for a signed-in professor with no CSRF token, want 403",
				route.Method, route.Path, recorder.Code)
		}
	}

	if checked == 0 {
		t.Fatal("no state-changing route in the table, so this test verified nothing")
	}
}
