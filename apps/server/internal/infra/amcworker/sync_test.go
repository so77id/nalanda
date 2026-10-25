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
	"time"

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
	// notStored, when set, runs the call and then fails the push the way
	// filestore.Sync does after a call that succeeded.
	notStored bool
}

func (s *recordingSync) record(event string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, event)
}

func (s *recordingSync) Around(_ context.Context, project string, call func() error) error {
	return s.around("", project, call)
}

// AroundDeferringDatabases records its halves apart, so a test can tell
// which of the two a call went through.
func (s *recordingSync) AroundDeferringDatabases(_ context.Context, project string, call func() error) error {
	return s.around("deferring-", project, call)
}

func (s *recordingSync) around(kind, project string, call func() error) error {
	s.record(kind + "hydrate " + project)
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
	s.record(kind + "push " + project)
	if err == nil && s.notStored {
		return fmt.Errorf("%w: %w: put: dial tcp: i/o timeout", files.ErrSync, files.ErrNotStored)
	}
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

// workerCall is one of the client's calls, and what its worker answers.
type workerCall struct {
	name, project, body string
	// defers: the call's sync is AroundDeferringDatabases (the annotate and
	// the resets).
	defers bool
	run    func(*amcworker.Client) error
}

// workerCalls is EVERY call the client makes to the worker. A new call is
// added here, and both tests below then hold it to the rule
// (apps/server/CLAUDE.md, the file store's rule 2).
func workerCalls(t *testing.T) []workerCall {
	t.Helper()
	surveyReport, err := os.ReadFile("testdata/survey-report.json")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	const generated = `{"sujet":"P/out/sujet.pdf","corrige":"P/out/corrige.pdf","calage":"P/out/calage.xy","copies":1}`
	return []workerCall{
		{"generate", "controls/A", generated, false, func(c *amcworker.Client) error {
			_, err := c.Generate(ctx, controls.GenerateRequest{Project: "controls/A", Source: "controls/A/inputs/source.tex", Copies: 1})
			return err
		}},
		{"survey generate", "surveys/1/runs/2", generated, false, func(c *amcworker.Client) error {
			_, err := c.GenerateSheet(ctx, survey.GenerateRequest{Project: "surveys/1/runs/2", Source: "surveys/1/runs/2/inputs/source.tex", Copies: 1})
			return err
		}},
		{"analyse", "controls/A", sampleReport, false, func(c *amcworker.Client) error {
			_, err := c.Analyze(ctx, controls.AnalyzeRequest{Project: "controls/A", ScanPDF: "controls/A/uploads/batch-1.pdf",
				Source: "controls/A/inputs/source.tex", Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure})
			return err
		}},
		{"reanalyse", "controls/A", sampleReport, false, func(c *amcworker.Client) error {
			_, err := c.Reanalyze(ctx, controls.ReanalyzeRequest{Project: "controls/A", Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure})
			return err
		}},
		{"annotate", "controls/A", `{"path":"controls/A/annotated/copy-1.pdf","copy":1}`, true, func(c *amcworker.Client) error {
			_, err := c.AnnotateCopy(ctx, controls.AnnotateRequest{Project: "controls/A", Copy: 1, Ticked: controls.DefaultTicked})
			return err
		}},
		{"survey analyse", "surveys/1/runs/2", string(surveyReport), false, func(c *amcworker.Client) error {
			_, err := c.AnalyzeSheets(ctx, survey.AnalyzeRequest{Project: "surveys/1/runs/2", ScanPDF: "surveys/1/runs/2/uploads/batch-1.pdf",
				Source: "surveys/1/runs/2/inputs/source.tex", Ticked: 0.3, Unsure: 0.1})
			return err
		}},
		{"reset", "controls/A", `{"project":"controls/A"}`, true, func(c *amcworker.Client) error {
			return c.ResetScans(ctx, "controls/A")
		}},
		{"survey reset", "surveys/1/runs/2", `{"project":"surveys/1/runs/2"}`, true, func(c *amcworker.Client) error {
			return c.ResetSurveyScans(ctx, "surveys/1/runs/2")
		}},
	}
}

func TestEveryWorkerCallRunsBetweenTheHydrateAndThePush(t *testing.T) {
	for _, tc := range workerCalls(t) {
		t.Run(tc.name, func(t *testing.T) {
			s := &recordingSync{}
			client := amcworker.New(amcworker.Config{BaseURL: workerAnswering(t, s, tc.body).URL, Sync: s})
			if err := tc.run(client); err != nil {
				t.Fatalf("call: %v", err)
			}
			kind := ""
			if tc.defers {
				kind = "deferring-"
			}
			want := []string{kind + "hydrate " + tc.project, "worker", kind + "push " + tc.project}
			if got := s.Events(); !slices.Equal(got, want) {
				t.Errorf("events = %v, want %v", got, want)
			}
		})
	}
}

// The sync is part of the critical section, for EVERY call (issue #338
// review, COR-3: this held for one call only, and dropping the lock from
// two others left the suite green). While a call is still in its sync, the
// lock is held: the purge's TryExclusive is refused as busy rather than
// deleting a project being copied.
func TestEveryWorkerCallsSyncRunsInsideTheWorkerLock(t *testing.T) {
	for _, tc := range workerCalls(t) {
		t.Run(tc.name, func(t *testing.T) {
			s := &recordingSync{entered: make(chan struct{}), hold: make(chan struct{})}
			client := amcworker.New(amcworker.Config{BaseURL: workerAnswering(t, s, tc.body).URL, Sync: s})

			done := make(chan error, 1)
			go func() { done <- tc.run(client) }()
			<-s.entered
			ran := false
			if err := client.TryExclusive(func() error { ran = true; return nil }); !errors.Is(err, controls.ErrAnalyzerBusy) || ran {
				t.Errorf("TryExclusive while %s was in its sync = %v (ran %v), want ErrAnalyzerBusy", tc.name, err, ran)
			}
			close(s.hold)
			if err := <-done; err != nil {
				t.Errorf("call: %v", err)
			}
			if err := client.TryExclusive(func() error { ran = true; return nil }); err != nil || !ran {
				t.Errorf("TryExclusive after %s = %v (ran %v), want it run", tc.name, err, ran)
			}
		})
	}
}

// COR-2: a call waiting for the lock gives up at its own deadline, instead
// of after the whole hold of the call ahead of it — and never reaches its
// sync or the worker.
func TestACallWaitingForTheLockGivesUpAtItsDeadline(t *testing.T) {
	s := &recordingSync{}
	client := amcworker.New(amcworker.Config{BaseURL: workerAnswering(t, s, `{"path":"controls/A/annotated/copy-1.pdf","copy":1}`).URL, Sync: s})
	holding, release := make(chan struct{}), make(chan struct{})
	go func() {
		_ = client.Exclusive(func() error {
			close(holding)
			<-release
			return nil
		})
	}()
	<-holding
	defer close(release)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := client.AnnotateCopy(ctx, controls.AnnotateRequest{Project: "controls/A", Copy: 1, Ticked: controls.DefaultTicked})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("AnnotateCopy behind a held lock = %v, want context.DeadlineExceeded", err)
	}
	if waited := time.Since(start); waited > time.Second {
		t.Errorf("AnnotateCopy gave up after %v, want about its 50 ms deadline", waited)
	}
	if got := s.Events(); len(got) != 0 {
		t.Errorf("a call that never had the lock reached %v", got)
	}
}

// COR-1: when AMC did its work and only the copy to the store failed, the
// calls whose result the domain persists return it WITH the error.
func TestAResultTheStoreDidNotTakeIsStillReturned(t *testing.T) {
	surveyReport, err := os.ReadFile("testdata/survey-report.json")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, tc := range []struct {
		name, body string
		run        func(*amcworker.Client) (kept bool, err error)
	}{
		{"analyse", sampleReport, func(c *amcworker.Client) (bool, error) {
			report, err := c.Analyze(ctx, controls.AnalyzeRequest{Project: "controls/A", ScanPDF: "controls/A/uploads/batch-1.pdf",
				Source: "controls/A/inputs/source.tex", Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure})
			return len(report.Copies) > 0 && report.Batch != nil, err
		}},
		{"survey analyse", string(surveyReport), func(c *amcworker.Client) (bool, error) {
			report, err := c.AnalyzeSheets(ctx, survey.AnalyzeRequest{Project: "surveys/1/runs/2", ScanPDF: "surveys/1/runs/2/uploads/batch-1.pdf",
				Source: "surveys/1/runs/2/inputs/source.tex", Ticked: 0.3, Unsure: 0.1})
			return len(report.Copies) > 0, err
		}},
		{"generate", `{"sujet":"controls/A/out/sujet.pdf","corrige":"c","calage":"k","copies":1}`, func(c *amcworker.Client) (bool, error) {
			assets, err := c.Generate(ctx, controls.GenerateRequest{Project: "controls/A", Source: "controls/A/inputs/source.tex", Copies: 1})
			return assets.Sujet == "controls/A/out/sujet.pdf", err
		}},
		{"survey generate", `{"sujet":"surveys/1/runs/2/out/sujet.pdf","corrige":"c","calage":"k","copies":1}`, func(c *amcworker.Client) (bool, error) {
			assets, err := c.GenerateSheet(ctx, survey.GenerateRequest{Project: "surveys/1/runs/2", Source: "surveys/1/runs/2/inputs/source.tex", Copies: 1})
			return assets.Sujet == "surveys/1/runs/2/out/sujet.pdf", err
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &recordingSync{notStored: true}
			client := amcworker.New(amcworker.Config{BaseURL: workerAnswering(t, s, tc.body).URL, Sync: s})
			kept, err := tc.run(client)
			if !errors.Is(err, files.ErrNotStored) || !errors.Is(err, files.ErrSync) {
				t.Errorf("err = %v, want files.ErrNotStored inside files.ErrSync", err)
			}
			if !kept {
				t.Error("the result AMC produced was thrown away")
			}
		})
	}
}

// ...but an annotate's path is not: a row pointing at a PDF the store may
// not hold would turn the review page's raw-scan fallback into an error.
func TestAnAnnotateTheStoreDidNotTakeReturnsNoPath(t *testing.T) {
	s := &recordingSync{notStored: true}
	client := amcworker.New(amcworker.Config{BaseURL: workerAnswering(t, s, `{"path":"controls/A/annotated/copy-1.pdf","copy":1}`).URL, Sync: s})
	path, err := client.AnnotateCopy(context.Background(), controls.AnnotateRequest{Project: "controls/A", Copy: 1, Ticked: controls.DefaultTicked})
	if !errors.Is(err, files.ErrSync) || path != "" {
		t.Errorf("AnnotateCopy = %q, %v; want no path and files.ErrSync", path, err)
	}
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
