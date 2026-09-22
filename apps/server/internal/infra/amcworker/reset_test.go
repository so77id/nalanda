package amcworker_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker"
)

func TestResetScansPostsTheProject(t *testing.T) {
	var gotPath, gotProject string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		var body struct {
			Project string `json:"project"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		gotProject = body.Project
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"project": "controls/X"}`))
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	if err := client.ResetScans(context.Background(), "controls/X"); err != nil {
		t.Fatalf("ResetScans: %v", err)
	}
	if gotPath != "/scans/reset" || gotProject != "controls/X" {
		t.Errorf("worker saw %s with project %q, want /scans/reset with controls/X", gotPath, gotProject)
	}
}

// The two CD workflows drift: the server can reach the Jetson ~25 minutes
// before the worker that has the route. The old worker's dispatcher
// answers 404, and that must arrive as a refusal the caller stops on —
// the server deletes nothing of its own after it.
func TestResetScansAgainstAWorkerWithoutTheRouteIsARefusal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error": "no route for POST /scans/reset"}`))
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	err := client.ResetScans(context.Background(), "controls/X")
	if !errors.Is(err, controls.ErrAnalyzerRefused) {
		t.Fatalf("ResetScans = %v, want ErrAnalyzerRefused", err)
	}
}
