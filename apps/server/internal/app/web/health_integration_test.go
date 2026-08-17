package web_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
)

// AC-3, over the real chain rather than a fake: the actual SQLite prober, the
// actual router, the actual status-code rule. The cases above use a stub, and a
// stub agrees with the handler by construction — it can only prove that the
// handler translates a report, never that anything produces the report from a
// database that is really gone.
func TestHealthIs503OverARealDatabaseThatHasGoneAway(t *testing.T) {
	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	router := web.Router(deps(t, storage.NewProber(db)))

	// Healthy first, so the 503 below is caused by the database going away and
	// not by a router that was never able to answer 200.
	healthy := httptest.NewRecorder()
	router.ServeHTTP(healthy, httptest.NewRequest(http.MethodGet, "/health", nil))
	if healthy.Code != http.StatusOK {
		t.Fatalf("status against a live database = %d, want %d", healthy.Code, http.StatusOK)
	}

	if err := db.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	gone := httptest.NewRecorder()
	router.ServeHTTP(gone, httptest.NewRequest(http.MethodGet, "/health", nil))
	if gone.Code != http.StatusServiceUnavailable {
		t.Errorf("status against a closed database = %d, want %d", gone.Code, http.StatusServiceUnavailable)
	}
	if body := gone.Body.String(); body == `{"process":"up","database":"up"}` {
		t.Errorf("body = %q, want it to report the database down", body)
	}
}
