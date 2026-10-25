package amcworker_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"sync"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/files"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker"
)

// Issue #338 §3: every worker call runs between the file store's hydrate
// and push, inside the worker lock — so nothing mutates a project while it
// is being copied. recordingSync stands in for filestore.Sync.
type recordingSync struct {
	mu     sync.Mutex
	events []string
	// entered, when set, is closed once Around is running; hold, when set,
	// keeps Around waiting there until it is closed.
	entered chan struct{}
	hold    chan struct{}
	// fail, when set, is returned instead of running the call — a hydrate
	// that could not reach the bucket.
	fail error
}

func (s *recordingSync) record(event string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, event)
}

func (s *recordingSync) Around(_ context.Context, project string, call func() error) error {
	s.record("hydrate " + project)
	if s.entered != nil {
		close(s.entered)
	}
	if s.hold != nil {
		<-s.hold
	}
	if s.fail != nil {
		return s.fail
	}
	err := call()
	s.record("push " + project)
	return err
}

func (s *recordingSync) Events() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.events...)
}

// workerAnswering answers every request with body, recording "worker" in
// the sync's log so the test can see the call sat between the two halves.
func workerAnswering(t *testing.T, s *recordingSync, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		s.record("worker")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestEveryWorkerCallRunsBetweenTheHydrateAndThePush(t *testing.T) {
	surveyReport, err := os.ReadFile("testdata/survey-report.json")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	const generated = `{"sujet":"P/out/sujet.pdf","corrige":"P/out/corrige.pdf","calage":"P/out/calage.xy","copies":1}`
	for _, tc := range []struct {
		name, project, body string
		run                 func(*amcworker.Client) error
	}{
		{"generate", "controls/A", generated, func(c *amcworker.Client) error {
			_, err := c.Generate(ctx, controls.GenerateRequest{Project: "controls/A", Source: "controls/A/inputs/source.tex", Copies: 1})
			return err
		}},
		{"survey generate", "surveys/1/runs/2", generated, func(c *amcworker.Client) error {
			_, err := c.GenerateSheet(ctx, survey.GenerateRequest{Project: "surveys/1/runs/2", Source: "surveys/1/runs/2/inputs/source.tex", Copies: 1})
			return err
		}},
		{"analyse", "controls/A", sampleReport, func(c *amcworker.Client) error {
			_, err := c.Analyze(ctx, controls.AnalyzeRequest{Project: "controls/A", ScanPDF: "controls/A/uploads/batch-1.pdf",
				Source: "controls/A/inputs/source.tex", Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure})
			return err
		}},
		{"reanalyse", "controls/A", sampleReport, func(c *amcworker.Client) error {
			_, err := c.Reanalyze(ctx, controls.ReanalyzeRequest{Project: "controls/A", Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure})
			return err
		}},
		{"annotate", "controls/A", `{"path":"controls/A/annotated/copy-1.pdf","copy":1}`, func(c *amcworker.Client) error {
			_, err := c.AnnotateCopy(ctx, controls.AnnotateRequest{Project: "controls/A", Copy: 1, Ticked: controls.DefaultTicked})
			return err
		}},
		{"survey analyse", "surveys/1/runs/2", string(surveyReport), func(c *amcworker.Client) error {
			_, err := c.AnalyzeSheets(ctx, survey.AnalyzeRequest{Project: "surveys/1/runs/2", ScanPDF: "surveys/1/runs/2/uploads/batch-1.pdf",
				Source: "surveys/1/runs/2/inputs/source.tex", Ticked: 0.3, Unsure: 0.1})
			return err
		}},
		{"reset", "controls/A", `{"project":"controls/A"}`, func(c *amcworker.Client) error {
			return c.ResetScans(ctx, "controls/A")
		}},
		{"survey reset", "surveys/1/runs/2", `{"project":"surveys/1/runs/2"}`, func(c *amcworker.Client) error {
			return c.ResetSurveyScans(ctx, "surveys/1/runs/2")
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &recordingSync{}
			client := amcworker.New(amcworker.Config{BaseURL: workerAnswering(t, s, tc.body).URL, Sync: s})
			if err := tc.run(client); err != nil {
				t.Fatalf("call: %v", err)
			}
			want := []string{"hydrate " + tc.project, "worker", "push " + tc.project}
			if got := s.Events(); !slices.Equal(got, want) {
				t.Errorf("events = %v, want %v", got, want)
			}
		})
	}
}

// The sync is part of the critical section: while one call is still
// hydrating, the lock is held — a reset, which only TRIES the lock, is
// refused as busy rather than running against a project being copied.
func TestTheSyncRunsInsideTheWorkerLock(t *testing.T) {
	s := &recordingSync{entered: make(chan struct{}), hold: make(chan struct{})}
	client := amcworker.New(amcworker.Config{BaseURL: workerAnswering(t, s, `{"project":"controls/B"}`).URL, Sync: s})

	done := make(chan error, 1)
	go func() {
		_, err := client.Reanalyze(context.Background(), controls.ReanalyzeRequest{
			Project: "controls/A", Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure})
		done <- err
	}()
	<-s.entered
	if err := client.ResetScans(context.Background(), "controls/B"); !errors.Is(err, controls.ErrAnalyzerBusy) {
		t.Errorf("a reset while another call was hydrating = %v, want ErrAnalyzerBusy", err)
	}
	close(s.hold)
	<-done
}

// A hydrate that fails never reaches the worker, and the caller hears the
// sync's own sentinel — which the job handlers name in Spanish.
func TestAHydrateFailureNeverReachesTheWorker(t *testing.T) {
	s := &recordingSync{fail: fmt.Errorf("%w: dial tcp: i/o timeout", files.ErrSync)}
	client := amcworker.New(amcworker.Config{BaseURL: workerAnswering(t, s, `{}`).URL, Sync: s})

	_, err := client.Generate(context.Background(), controls.GenerateRequest{Project: "controls/A", Source: "controls/A/inputs/source.tex", Copies: 1})
	if !errors.Is(err, files.ErrSync) {
		t.Errorf("Generate = %v, want files.ErrSync", err)
	}
	if slices.Contains(s.Events(), "worker") {
		t.Error("the worker was called after a failed hydrate")
	}
}
