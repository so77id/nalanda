// Package jobs is the async job runner for the four minutes-class AMC
// operations (generate, analyse, reanalyse, annotate batch) — issue #249.
//
// One goroutine, one queue, one job at a time. The runner persists every
// job in SQLite so a Watchtower restart (ADR-0038) does not lose the queue:
// on boot the Sweep pass re-pushes `queued` rows and marks any `running`
// row as `failed` — a "server_restart_mid_job" the professor sees on the
// banner, not a silently retried job. See docs/decisions and issue #249
// §Design for the reasoning; this package holds the types the runner and
// the store agree on.
package jobs

import (
	"context"
	"errors"
	"time"
)

// Kind names the four operation types the runner accepts. Enumerated
// rather than free-form: the SQLite CHECK on job.kind refuses anything
// else, and having the enum here means a caller cannot write a typo that
// only fails at INSERT time.
type Kind string

const (
	KindGenerate  Kind = "generate"
	KindAnalyse   Kind = "analyse"
	KindReanalyse Kind = "reanalyse"
	KindAnnotate  Kind = "annotate"
)

// ValidKinds is the closed set the schema CHECK enforces.
var ValidKinds = []Kind{KindGenerate, KindAnalyse, KindReanalyse, KindAnnotate}

// Status names the four states a row can be in. Same CHECK-enum shape as
// Kind, same reasoning.
type Status string

const (
	StatusQueued  Status = "queued"
	StatusRunning Status = "running"
	StatusDone    Status = "done"
	StatusFailed  Status = "failed"
)

// RestartMidJobError is the marker error the Sweep pass writes into
// job.error when it finds a `running` row on boot — the previous server
// died mid-job, so the professor sees "server_restart_mid_job" on the
// banner rather than a stalled row that never moves.
const RestartMidJobError = "server_restart_mid_job"

// Job is one row of the `job` table.
type Job struct {
	ID         int64
	ControlID  string
	Kind       Kind
	Status     Status
	Error      string
	Detail     string
	Payload    []byte
	CreatedAt  time.Time
	StartedAt  *time.Time
	FinishedAt *time.Time
	ViewedAt   *time.Time
}

// NewJob is what Store.Insert accepts. It carries the fields a caller
// composes; the store fills in id, created_at, and the initial status.
type NewJob struct {
	ControlID string
	Kind      Kind
	Payload   []byte
}

// Store is what the Runner reaches into for persistence — declared here,
// on the domain side, per backend-code-style.md §The dependency rule.
// The jobstore package implements it over SQLite.
type Store interface {
	// Insert creates a new job in `queued`, stamps createdAt on the
	// row and returns its id. The runner passes r.now() from its
	// injected clock, so tests share the same clock the mark family
	// already accepts.
	Insert(ctx context.Context, j NewJob, createdAt time.Time) (int64, error)

	// MarkRunning transitions a job to `running` and stamps started_at.
	// Returns ErrJobNotFound when no row has that id.
	MarkRunning(ctx context.Context, id int64, startedAt time.Time) error

	// MarkDone transitions a job to `done` and stamps finished_at.
	MarkDone(ctx context.Context, id int64, finishedAt time.Time) error

	// MarkFailed transitions a job to `failed` with a short error message
	// (banner-visible) and a long detail (debug), and stamps finished_at.
	MarkFailed(ctx context.Context, id int64, msg, detail string, finishedAt time.Time) error

	// MarkDismissed stamps viewed_at so the banner disappears. Idempotent:
	// a second call replaces the timestamp with the newer one.
	MarkDismissed(ctx context.Context, id int64, at time.Time) error

	// ByID returns one job, or ErrJobNotFound.
	ByID(ctx context.Context, id int64) (Job, error)

	// LatestForControl returns the most recent job for a control (highest
	// created_at). Returns ErrJobNotFound when the control has no jobs.
	// The Detail handler renders the banner from this row.
	LatestForControl(ctx context.Context, controlID string) (Job, error)

	// QueuedIDs returns every `queued` job's id, oldest first. Sweep calls
	// this once at boot to re-push them onto the runner's channel.
	QueuedIDs(ctx context.Context) ([]int64, error)

	// FailRunningWithMessage transitions every `running` row to `failed`
	// with the given short error and stamps finished_at. Sweep calls this
	// once at boot with RestartMidJobError so a job that was running when
	// the server died surfaces on the banner rather than staying open
	// forever. Returns the number of rows updated.
	FailRunningWithMessage(ctx context.Context, msg string, finishedAt time.Time) (int, error)
}

// ErrJobNotFound is what Store.ByID and MarkRunning/Done/Failed answer
// when no row has the id in question — a caller that races a delete or
// hands a bogus id gets a distinguishable error.
var ErrJobNotFound = errors.New("jobs: no such job")
