package api_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/api"
	"github.com/so77id/nalanda/apps/server/internal/domain/health"
)

type proberFunc func(context.Context) error

func (f proberFunc) Probe(ctx context.Context) error { return f(ctx) }

var (
	reachable   = proberFunc(func(context.Context) error { return nil })
	unreachable = proberFunc(func(context.Context) error { return errors.New("no such file or directory") })
)

func TestHealthIs200AndReportsBothComponentsUp(t *testing.T) {
	rec := httptest.NewRecorder()
	api.Router(reachable, testLogger()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	var report health.Report
	if err := json.NewDecoder(rec.Body).Decode(&report); err != nil {
		t.Fatalf("decoding the body: %v", err)
	}
	if report.Process != health.StatusUp || report.Database != health.StatusUp {
		t.Errorf("report = %+v, want both components up", report)
	}
}

// AC-3, at the surface: a database that cannot be reached is a NON-200. An
// endpoint that returns 200 with a body saying "down" is read as healthy by
// every orchestrator that has ever existed.
func TestHealthIs503WhenTheDatabaseIsUnreachable(t *testing.T) {
	rec := httptest.NewRecorder()
	api.Router(unreachable, testLogger()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}

	var report health.Report
	if err := json.NewDecoder(rec.Body).Decode(&report); err != nil {
		t.Fatalf("decoding the body: %v", err)
	}
	if report.Database != health.StatusDown {
		t.Errorf("Database = %q, want %q", report.Database, health.StatusDown)
	}
}

// The anonymous surface must NOT carry the diagnostic. Its callers are
// students' browsers, and the field will hold a Postgres DSN once ADR-0007's
// swap happens — `failed to connect to host=… user=…` (#149 review, F2).
// The backoffice surface keeps it; that asymmetry is what `internal/app/api`
// exists to express, and web/router_test.go asserts the other half.
func TestHealthDoesNotLeakTheCauseToAnonymousCallers(t *testing.T) {
	rec := httptest.NewRecorder()
	api.Router(unreachable, testLogger()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	body := rec.Body.String()
	if strings.Contains(body, "no such file or directory") {
		t.Errorf("body = %q, want the prober's message withheld from this surface", body)
	}

	var report health.Report
	if err := json.NewDecoder(strings.NewReader(body)).Decode(&report); err != nil {
		t.Fatalf("decoding the body: %v", err)
	}
	if report.Error != "" {
		t.Errorf("Error = %q on the anonymous surface, want it empty", report.Error)
	}
	// Still useful: the caller learns WHICH component is down, just not why.
	if report.Database != health.StatusDown {
		t.Errorf("Database = %q, want %q — withholding the cause must not withhold the verdict", report.Database, health.StatusDown)
	}
}

// The surface is anonymous students' and it serves JSON. A browser reaching it
// from apps/web is a WP-C2 problem (no CORS here yet, ADR-0008: contracts
// arrive with a consumer), but the method contract is owed now — Go's ServeMux
// answers 405 for a registered pattern with the wrong method only when the
// method is part of the pattern.
func TestHealthRejectsANonGetMethod(t *testing.T) {
	rec := httptest.NewRecorder()
	api.Router(reachable, testLogger()).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/health", nil))

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

// The API surface serves its OWN half and nothing else. This is the boundary
// C11 asks to be drawn now: a path that belongs to the backoffice must not be
// answerable here, so the day web grows routes nobody has to discover that api
// was quietly serving them too.
func TestApiServesNothingButItsOwnHalf(t *testing.T) {
	for _, path := range []string{"/", "/health", "/admin", "/api/"} {
		rec := httptest.NewRecorder()
		api.Router(reachable, testLogger()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

		if rec.Code == http.StatusOK {
			t.Errorf("GET %s = 200, want a non-200: the api surface serves only /api/health today", path)
		}
	}
}

// testLogger discards output: these cases are about status codes and bodies,
// and a logger writing to the test's stderr only makes a failure harder to read.
func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
