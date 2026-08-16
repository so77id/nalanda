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
	"github.com/so77id/nalanda/apps/server/internal/domain/health"
	"github.com/so77id/nalanda/apps/server/internal/infra/oidc/oidctest"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

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
			Sessions: store, Users: store, Now: time.Now, SecureCookie: true, Log: logger,
		}),
		Login: handler.NewAuth(handler.Auth{
			Login: &auth.Login{
				Users: store, Identities: store, Sessions: store,
				Now: time.Now, SessionTTL: time.Hour,
			},
			Provider:     &oidctest.Provider{},
			ProviderName: "google",
			State:        oauthstate.New(time.Minute, time.Now),
			PublicURL:    "https://nalanda.test",
			SecureCookie: true,
			Log:          logger,
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

// The backoffice still has no SCREENS (WP-C3), which is now a narrower claim
// than it was: /login exists since #150 and is asserted separately below. The
// case is kept because the emptiness is deliberate, and the first person to add
// a screen should know they are the first.
func TestTheBackofficeHasNoScreensYet(t *testing.T) {
	for _, path := range []string{"/", "/admin", "/cursos"} {
		rec := httptest.NewRecorder()
		web.Router(deps(t, reachable)).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404: the screens arrive with WP-C3 (#151)", path, rec.Code)
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
