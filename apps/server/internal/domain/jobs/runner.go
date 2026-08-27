package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// Handler is what the runner reaches into for each Kind. Registered at
// wiring time in cmd/server; the runner never imports the controls
// domain itself (backend-code-style.md §The dependency rule). controlID
// and payload are what Submit stored on the row, verbatim: the handler
// deserialises the payload against the kind it registered for.
type Handler func(ctx context.Context, controlID string, payload []byte) error

// Handlers is the map keyed by Kind. NewRunner refuses to construct a
// runner missing any handler — a wiring mistake is a panic at boot
// rather than a `no handler for kind X` at first submit.
type Handlers map[Kind]Handler

// Failure is the shape a handler returns when the runner should record a
// distinct short (banner) message and a long (debug) detail on the
// failed row. When the handler returns a plain error, the runner uses
// err.Error() for the banner and stores no detail — same shape the
// flash cookie's refusedFlash already draws in scans.go.
type Failure struct {
	Message string
	Detail  string
}

// Error makes Failure satisfy the error interface — a handler can just
// `return &jobs.Failure{Message: ..., Detail: ...}`.
func (f *Failure) Error() string { return f.Message }

// Runner is the single-goroutine job runner (issue #249 §Design). It
// serialises AMC work at a level above amcworker.Client's own mutex — the
// mutex stays as a defense in depth for any future sync caller that does
// not go through the runner.
type Runner struct {
	store    Store
	handlers Handlers
	log      *slog.Logger
	now      func() time.Time

	// ch is the fast-path notification channel. Submit pushes an id when
	// there is room; Start reads it and dispatches. Buffered so a burst
	// of submissions does not block the caller's HTTP handler. When the
	// buffer fills, Submit falls back to "the row is already `queued`
	// in the store" — Start's drain-after-each pass picks it up.
	ch chan int64
}

// runnerBuffer is the channel buffer size — deliberately large enough to
// absorb any professor's realistic burst (a class of 30 copies produces
// one job per operation, not thirty). Overflow does not lose work:
// Start.drain re-scans the store after every job.
const runnerBuffer = 256

// NewRunner returns a Runner over store, with a Handler registered for
// every Kind. Same shape as controls.NewService: a wiring mistake is a
// panic at boot (backend-code-style.md §Errors).
func NewRunner(store Store, handlers Handlers, log *slog.Logger, now func() time.Time) *Runner {
	switch {
	case store == nil:
		panic("jobs.NewRunner: no store")
	case log == nil:
		panic("jobs.NewRunner: no logger")
	case now == nil:
		panic("jobs.NewRunner: no clock")
	}
	for _, kind := range ValidKinds {
		if _, ok := handlers[kind]; !ok {
			panic("jobs.NewRunner: no handler for kind " + string(kind))
		}
	}
	return &Runner{
		store:    store,
		handlers: handlers,
		log:      log,
		now:      now,
		ch:       make(chan int64, runnerBuffer),
	}
}

// Submit inserts a job in `queued` and notifies the runner. Returns the
// job's id so the caller can render "job N encolado" or redirect to a
// page that renders the banner from the latest job. Fast — no AMC call
// happens on this path.
func (r *Runner) Submit(ctx context.Context, controlID string, kind Kind, payload []byte) (int64, error) {
	if _, ok := r.handlers[kind]; !ok {
		return 0, fmt.Errorf("jobs.Runner.Submit: no handler for kind %q", kind)
	}
	id, err := r.store.Insert(ctx, NewJob{ControlID: controlID, Kind: kind, Payload: payload})
	if err != nil {
		return 0, fmt.Errorf("jobs.Runner.Submit: %w", err)
	}
	select {
	case r.ch <- id:
	default:
		r.log.Warn("jobs: notification channel full; runner will pick this row up on its next drain",
			"id", id, "kind", string(kind), "control", controlID)
	}
	return id, nil
}

// Sweep runs exactly once at boot, BEFORE Start (§Design: "corre UNA
// vez desde main.go"). Two passes: mark every `running` row as `failed`
// with RestartMidJobError (the previous server died mid-job), then
// re-push every `queued` row onto the channel so the runner picks up
// where it left off.
func (r *Runner) Sweep(ctx context.Context) error {
	n, err := r.store.FailRunningWithMessage(ctx, RestartMidJobError, r.now())
	if err != nil {
		return fmt.Errorf("jobs.Runner.Sweep: fail running: %w", err)
	}
	if n > 0 {
		r.log.Warn("jobs: sweep marked running jobs as failed",
			"count", n, "reason", RestartMidJobError)
	}
	ids, err := r.store.QueuedIDs(ctx)
	if err != nil {
		return fmt.Errorf("jobs.Runner.Sweep: list queued: %w", err)
	}
	for _, id := range ids {
		select {
		case r.ch <- id:
		default:
			// See runnerBuffer: the row stays `queued`, so Start's
			// drain will find it. A very large boot backlog is the
			// only way here, and it self-heals.
			r.log.Warn("jobs: sweep re-push dropped by full channel", "id", id)
		}
	}
	if len(ids) > 0 {
		r.log.Info("jobs: sweep re-pushed queued jobs", "count", len(ids))
	}
	return nil
}

// Start blocks in the runner's one goroutine, reading ids off the
// channel and dispatching them. Returns when ctx is done. Runs on the
// caller's goroutine — cmd/server wires it as `go runner.Start(ctx)`.
//
// After each job, drainStore looks for any queued rows the channel
// might have dropped (buffer overflow, or rows inserted while another
// job was running and the notification was raced by a closer submit).
// Cheap: one SELECT that returns nothing in the common case.
func (r *Runner) Start(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case id := <-r.ch:
			r.runOne(ctx, id)
			r.drainStore(ctx)
		}
	}
}

// drainStore repeatedly asks the store for queued rows and runs them
// until the store answers empty. Runs synchronously in Start's
// goroutine, so the single-writer invariant against the amcworker stays.
func (r *Runner) drainStore(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		ids, err := r.store.QueuedIDs(ctx)
		if err != nil {
			r.log.Error("jobs: drain queued", "error", err)
			return
		}
		if len(ids) == 0 {
			return
		}
		for _, id := range ids {
			if ctx.Err() != nil {
				return
			}
			r.runOne(ctx, id)
		}
	}
}

// runOne executes one job end-to-end. Not atomic on the DB side: the row
// moves queued → running → done|failed through three writes. A crash
// between the writes leaves a `running` row that the next boot's Sweep
// catches (RestartMidJobError). A panic in the handler is recovered so
// one bad job does not kill the runner's only goroutine.
func (r *Runner) runOne(ctx context.Context, id int64) {
	job, err := r.store.ByID(ctx, id)
	if err != nil {
		r.log.Error("jobs: fetch", "id", id, "error", err)
		return
	}
	if job.Status != StatusQueued {
		// Already picked up by Sweep or a duplicate channel push. The
		// runner never runs a row twice — the terminal write from the
		// previous run stands.
		return
	}
	if err := r.store.MarkRunning(ctx, id, r.now()); err != nil {
		r.log.Error("jobs: mark running", "id", id, "error", err)
		return
	}
	handler := r.handlers[job.Kind]
	handlerErr := r.callHandler(ctx, handler, job)
	if handlerErr == nil {
		if err := r.store.MarkDone(ctx, id, r.now()); err != nil {
			r.log.Error("jobs: mark done", "id", id, "error", err)
		}
		r.log.Info("jobs: job done",
			"id", id, "kind", string(job.Kind), "control", job.ControlID)
		return
	}
	msg, detail := extractFailure(handlerErr)
	if err := r.store.MarkFailed(ctx, id, msg, detail, r.now()); err != nil {
		r.log.Error("jobs: mark failed", "id", id, "error", err)
	}
	r.log.Warn("jobs: job failed",
		"id", id, "kind", string(job.Kind), "control", job.ControlID, "error", msg)
}

// callHandler runs the handler with a defer/recover so a panic surfaces
// as a Failure with the panic value rather than crashing the runner.
func (r *Runner) callHandler(ctx context.Context, handler Handler, job Job) (err error) {
	defer func() {
		if p := recover(); p != nil {
			err = &Failure{
				Message: fmt.Sprintf("panic: %v", p),
				Detail:  fmt.Sprintf("panic while running kind=%s id=%d control=%s: %v", job.Kind, job.ID, job.ControlID, p),
			}
		}
	}()
	return handler(ctx, job.ControlID, job.Payload)
}

// extractFailure pulls the (message, detail) pair the handler wanted the
// runner to record. A *Failure carries both; any other error uses
// err.Error() for the message and empty detail.
func extractFailure(err error) (msg, detail string) {
	var f *Failure
	if errors.As(err, &f) {
		return f.Message, f.Detail
	}
	return err.Error(), ""
}
