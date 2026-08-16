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
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/api"
)

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
	handler := rootHandler(reachable, testLogger())

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
	handler := rootHandler(unreachable, testLogger())

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
	composed := rootHandler(reachable, testLogger())

	// Grown by hand deliberately: ServeMux cannot enumerate its patterns, so a
	// new API route is added here too. The failure when it is not is loud and
	// immediate, which is the property the inline version did not have.
	apiRoutes := []string{"/api/health"}

	for _, path := range apiRoutes {
		direct := httptest.NewRecorder()
		api.Router(reachable, testLogger()).ServeHTTP(direct, httptest.NewRequest(http.MethodGet, path, nil))

		through := httptest.NewRecorder()
		composed.ServeHTTP(through, httptest.NewRequest(http.MethodGet, path, nil))

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
	handler := rootHandler(reachable, testLogger())

	// Registered by neither surface. It must 404, not be absorbed by "/".
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/nothing-here", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /api/nothing-here = %d, want 404", rec.Code)
	}

	// And the backoffice still has no screens (WP-C3).
	root := httptest.NewRecorder()
	handler.ServeHTTP(root, httptest.NewRequest(http.MethodGet, "/", nil))
	if root.Code != http.StatusNotFound {
		t.Errorf("GET / = %d, want 404 until WP-C3 (#151)", root.Code)
	}
}
