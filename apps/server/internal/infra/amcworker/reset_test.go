package amcworker_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

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

// #298 review, COR-1: the client's lock is ONE mutex for every project and
// does not watch ctx. A reset behind another control's analyse must refuse
// at once, not hang the professor's request past its deadline.
func TestResetScansRefusesWhileAnotherJobHoldsTheWorker(t *testing.T) {
	analysing := make(chan struct{})
	release := make(chan struct{})
	var resetReached atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/scans/reset" {
			resetReached.Store(true)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
			return
		}
		close(analysing)
		<-release
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(sampleReport))
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = client.Analyze(context.Background(), controls.AnalyzeRequest{
			Project: "controls/OTHER", ScanPDF: "s", Source: "t",
			Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure,
		})
	}()
	<-analysing

	start := time.Now()
	err := client.ResetScans(context.Background(), "controls/X")
	elapsed := time.Since(start)
	close(release)
	<-done

	if !errors.Is(err, controls.ErrAnalyzerBusy) {
		t.Fatalf("ResetScans during another analyse = %v, want ErrAnalyzerBusy", err)
	}
	if elapsed > time.Second {
		t.Errorf("ResetScans took %v, want an immediate refusal", elapsed)
	}
	if resetReached.Load() {
		t.Error("the worker received /scans/reset although the client refused")
	}
}
