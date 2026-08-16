package web_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web"
)

type proberFunc func(context.Context) error

func (f proberFunc) Probe(ctx context.Context) error { return f(ctx) }

var (
	reachable   = proberFunc(func(context.Context) error { return nil })
	unreachable = proberFunc(func(context.Context) error { return errors.New("no such file or directory") })
)

func TestHealthIs200WhenTheDatabaseAnswers(t *testing.T) {
	rec := httptest.NewRecorder()
	web.Router(reachable, testLogger()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

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
	web.Router(unreachable, testLogger()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	if body := rec.Body.String(); !strings.Contains(body, "down") {
		t.Errorf("body = %q, want it to name the component that is down", body)
	}
}

func TestHealthRejectsANonGetMethod(t *testing.T) {
	rec := httptest.NewRecorder()
	web.Router(reachable, testLogger()).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/health", nil))

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

// The backoffice has no screens yet (WP-C3). Asserting that says out loud that
// the emptiness is deliberate, so the first person to add a route knows they
// are the first rather than wondering what they broke.
func TestTheBackofficeHasNoScreensYet(t *testing.T) {
	for _, path := range []string{"/", "/admin", "/login"} {
		rec := httptest.NewRecorder()
		web.Router(reachable, testLogger()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404: the backoffice arrives with WP-C3 (#151)", path, rec.Code)
		}
	}
}

// testLogger discards output: these cases are about status codes and bodies,
// and a logger writing to the test's stderr only makes a failure harder to read.
func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
