package jobs_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
)

// fakeStore is an in-memory jobs.Store — the domain cannot depend on
// infra (backend-code-style.md §The dependency rule), so the runner
// tests run against a hand-rolled store rather than the SQLite one.
// The jobstore package has its own round-trip tests over SQLite (S1).
type fakeStore struct {
	mu      sync.Mutex
	jobs    map[int64]*jobs.Job
	nextID  int64
	newAtFn func() time.Time
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		jobs:    map[int64]*jobs.Job{},
		nextID:  0,
		newAtFn: time.Now,
	}
}

func (s *fakeStore) Insert(_ context.Context, j jobs.NewJob, at time.Time) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextID++
	id := s.nextID
	s.jobs[id] = &jobs.Job{
		ID:        id,
		ControlID: j.ControlID,
		Kind:      j.Kind,
		Status:    jobs.StatusQueued,
		Payload:   append([]byte(nil), j.Payload...),
		CreatedAt: at,
	}
	return id, nil
}

func (s *fakeStore) MarkRunning(_ context.Context, id int64, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok {
		return jobs.ErrJobNotFound
	}
	j.Status = jobs.StatusRunning
	t := at
	j.StartedAt = &t
	return nil
}

func (s *fakeStore) MarkDone(_ context.Context, id int64, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok {
		return jobs.ErrJobNotFound
	}
	j.Status = jobs.StatusDone
	t := at
	j.FinishedAt = &t
	return nil
}

func (s *fakeStore) MarkFailed(_ context.Context, id int64, msg, detail string, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok {
		return jobs.ErrJobNotFound
	}
	j.Status = jobs.StatusFailed
	j.Error = msg
	j.Detail = detail
	t := at
	j.FinishedAt = &t
	return nil
}

func (s *fakeStore) MarkDismissed(_ context.Context, id int64, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok {
		return jobs.ErrJobNotFound
	}
	t := at
	j.ViewedAt = &t
	return nil
}

func (s *fakeStore) ByID(_ context.Context, id int64) (jobs.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok {
		return jobs.Job{}, jobs.ErrJobNotFound
	}
	return *j, nil
}

func (s *fakeStore) LatestForControl(_ context.Context, controlID string) (jobs.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var latest *jobs.Job
	for _, j := range s.jobs {
		if j.ControlID != controlID {
			continue
		}
		if latest == nil || j.CreatedAt.After(latest.CreatedAt) ||
			(j.CreatedAt.Equal(latest.CreatedAt) && j.ID > latest.ID) {
			latest = j
		}
	}
	if latest == nil {
		return jobs.Job{}, jobs.ErrJobNotFound
	}
	return *latest, nil
}

func (s *fakeStore) LatestForControlByKind(_ context.Context, controlID string, kind jobs.Kind) (jobs.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var latest *jobs.Job
	for _, j := range s.jobs {
		if j.ControlID != controlID || j.Kind != kind {
			continue
		}
		if latest == nil || j.CreatedAt.After(latest.CreatedAt) ||
			(j.CreatedAt.Equal(latest.CreatedAt) && j.ID > latest.ID) {
			latest = j
		}
	}
	if latest == nil {
		return jobs.Job{}, jobs.ErrJobNotFound
	}
	return *latest, nil
}

func (s *fakeStore) QueuedIDs(_ context.Context) ([]int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var ids []int64
	// Preserve id-ascending order (proxy for insertion order in the
	// fake — real store orders by created_at first).
	for id := int64(1); id <= s.nextID; id++ {
		j, ok := s.jobs[id]
		if !ok {
			continue
		}
		if j.Status == jobs.StatusQueued {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func (s *fakeStore) FailRunningWithMessage(_ context.Context, msg string, at time.Time) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, j := range s.jobs {
		if j.Status == jobs.StatusRunning {
			j.Status = jobs.StatusFailed
			j.Error = msg
			t := at
			j.FinishedAt = &t
			n++
		}
	}
	return n, nil
}

// stubHandlers returns a Handlers map with `handler` bound to `kind`
// and no-ops registered for the other ValidKinds — NewRunner refuses a
// map missing any of the four kinds since ARQ-3.
func stubHandlers(kind jobs.Kind, handler jobs.Handler) jobs.Handlers {
	noop := func(context.Context, string, []byte) error { return nil }
	h := jobs.Handlers{}
	for _, k := range jobs.ValidKinds {
		if k == kind {
			h[k] = handler
		} else {
			h[k] = noop
		}
	}
	return h
}

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// waitForStatus polls the store until the job reaches `want` or the
// deadline expires. Runner processes jobs asynchronously; without this
// the tests would race the goroutine.
func waitForStatus(t *testing.T, store *fakeStore, id int64, want jobs.Status) jobs.Job {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		j, err := store.ByID(context.Background(), id)
		if err != nil {
			t.Fatalf("ByID(%d): %v", id, err)
		}
		if j.Status == want {
			return j
		}
		if time.Now().After(deadline) {
			t.Fatalf("job %d never reached %q (last status %q)", id, want, j.Status)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestRunnerMovesAJobFromQueuedToRunningToDone(t *testing.T) {
	store := newFakeStore()
	// Signal-back channel proves the handler observed status=running
	// while it was executing — not just that the end state is done.
	seenRunning := make(chan bool, 1)
	handler := func(ctx context.Context, controlID string, payload []byte) error {
		j, err := store.ByID(ctx, mustLatestID(t, store))
		if err != nil {
			return err
		}
		seenRunning <- (j.Status == jobs.StatusRunning)
		return nil
	}
	runner := jobs.NewRunner(store, stubHandlers(jobs.KindReanalyse, handler),
		silentLogger(), time.Now)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go runner.Start(ctx)

	id, err := runner.Submit(ctx, "CTRL001", jobs.KindReanalyse, []byte(`{}`))
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}

	select {
	case saw := <-seenRunning:
		if !saw {
			t.Errorf("handler ran but job was not in status=running")
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("handler never ran")
	}
	final := waitForStatus(t, store, id, jobs.StatusDone)
	if final.StartedAt == nil {
		t.Errorf("Done job has nil StartedAt")
	}
	if final.FinishedAt == nil {
		t.Errorf("Done job has nil FinishedAt")
	}
}

func TestRunnerRecordsAHandlerErrorAsFailedWithMessage(t *testing.T) {
	store := newFakeStore()
	handler := func(context.Context, string, []byte) error {
		return errors.New("boom")
	}
	runner := jobs.NewRunner(store, stubHandlers(jobs.KindAnalyse, handler),
		silentLogger(), time.Now)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go runner.Start(ctx)

	id, err := runner.Submit(ctx, "CTRL001", jobs.KindAnalyse, []byte(`{}`))
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	final := waitForStatus(t, store, id, jobs.StatusFailed)
	if final.Error != "boom" {
		t.Errorf("Error = %q, want %q", final.Error, "boom")
	}
	if final.Detail != "" {
		t.Errorf("Detail = %q, want empty for a plain error", final.Detail)
	}
}

func TestRunnerSplitsFailureIntoMessageAndDetail(t *testing.T) {
	store := newFakeStore()
	handler := func(context.Context, string, []byte) error {
		return &jobs.Failure{Message: "worker refused", Detail: "ERR: line 1\nERR: line 2"}
	}
	runner := jobs.NewRunner(store, stubHandlers(jobs.KindAnalyse, handler),
		silentLogger(), time.Now)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go runner.Start(ctx)

	id, err := runner.Submit(ctx, "CTRL001", jobs.KindAnalyse, []byte(`{}`))
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	final := waitForStatus(t, store, id, jobs.StatusFailed)
	if final.Error != "worker refused" {
		t.Errorf("Error = %q, want %q", final.Error, "worker refused")
	}
	if final.Detail != "ERR: line 1\nERR: line 2" {
		t.Errorf("Detail = %q, want the two-line context", final.Detail)
	}
}

func TestRunnerRecoversFromAHandlerPanic(t *testing.T) {
	store := newFakeStore()
	handler := func(context.Context, string, []byte) error {
		panic("kablooie")
	}
	runner := jobs.NewRunner(store, stubHandlers(jobs.KindGenerate, handler),
		silentLogger(), time.Now)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go runner.Start(ctx)

	id, err := runner.Submit(ctx, "CTRL001", jobs.KindGenerate, []byte(`{}`))
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	final := waitForStatus(t, store, id, jobs.StatusFailed)
	if final.Error == "" {
		t.Errorf("Error is empty, want the panic value in the banner")
	}
	if final.Detail == "" {
		t.Errorf("Detail is empty, want the panic context in the debug column")
	}
	// A subsequent submit still runs — the recover kept the goroutine
	// alive.
	next, _ := runner.Submit(ctx, "CTRL001", jobs.KindGenerate, []byte(`{}`))
	// Both jobs failed, but they both ran — proves the recover held.
	waitForStatus(t, store, next, jobs.StatusFailed)
}

func TestSweepRePushesQueuedRowsToTheRunner(t *testing.T) {
	store := newFakeStore()
	ran := make(chan int64, 4)
	handler := func(_ context.Context, controlID string, payload []byte) error {
		ran <- 1
		return nil
	}
	runner := jobs.NewRunner(store, stubHandlers(jobs.KindReanalyse, handler),
		silentLogger(), time.Now)

	// Simulate a pre-existing queued row (as if the previous server
	// wrote it but died before pushing to the in-memory channel).
	id, err := store.Insert(context.Background(), jobs.NewJob{
		ControlID: "CTRL001", Kind: jobs.KindReanalyse, Payload: []byte(`{}`),
	}, time.Now())
	if err != nil {
		t.Fatalf("seeding queued row: %v", err)
	}
	if err := runner.Sweep(context.Background()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go runner.Start(ctx)

	select {
	case <-ran:
	case <-time.After(2 * time.Second):
		t.Fatalf("Sweep did not re-push queued row %d", id)
	}
	waitForStatus(t, store, id, jobs.StatusDone)
}

func TestSweepFailsRunningRowsFromABeforeCrashAsRestartMidJob(t *testing.T) {
	store := newFakeStore()
	// Seed a `running` row (previous server died mid-job).
	id, err := store.Insert(context.Background(), jobs.NewJob{
		ControlID: "CTRL001", Kind: jobs.KindAnalyse, Payload: []byte(`{}`),
	}, time.Now())
	if err != nil {
		t.Fatalf("seeding: %v", err)
	}
	if err := store.MarkRunning(context.Background(), id, time.Now()); err != nil {
		t.Fatalf("MarkRunning: %v", err)
	}

	runner := jobs.NewRunner(store, stubHandlers(jobs.KindAnalyse,
		func(context.Context, string, []byte) error { return nil }),
		silentLogger(), time.Now)

	if err := runner.Sweep(context.Background()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	got, _ := store.ByID(context.Background(), id)
	if got.Status != jobs.StatusFailed {
		t.Errorf("Sweep left status = %q, want failed", got.Status)
	}
	if got.Error != jobs.RestartMidJobError {
		t.Errorf("Sweep wrote Error = %q, want %q", got.Error, jobs.RestartMidJobError)
	}
	if got.FinishedAt == nil {
		t.Errorf("Sweep did not stamp FinishedAt")
	}
}

// ARQ-3 (issue #249): NewRunner refuses a Handlers map missing any of
// the four ValidKinds — a wiring mistake is a panic at boot, matching
// how NewService / NewControls / NewAuth already refuse a nil
// dependency (apps/server/CLAUDE.md rules-for-Claude, §Errors).
func TestNewRunnerPanicsWhenAKindHasNoHandler(t *testing.T) {
	store := newFakeStore()
	defer func() {
		if r := recover(); r == nil {
			t.Errorf("NewRunner accepted a Handlers map missing KindAnnotate; want a boot-time panic")
		}
	}()
	// Handlers has three of the four kinds — KindAnnotate is missing.
	handlers := jobs.Handlers{
		jobs.KindReanalyse: func(context.Context, string, []byte) error { return nil },
		jobs.KindAnalyse:   func(context.Context, string, []byte) error { return nil },
		jobs.KindGenerate:  func(context.Context, string, []byte) error { return nil },
	}
	jobs.NewRunner(store, handlers, silentLogger(), time.Now)
}

// mustLatestID reads back the store's latest job id — a helper for
// handlers that need to see the row the runner just flipped to running.
func mustLatestID(t *testing.T, s *fakeStore) int64 {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nextID
}
