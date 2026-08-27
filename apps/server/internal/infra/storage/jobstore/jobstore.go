// Package jobstore is the SQLite side of the jobs domain: one type
// implementing jobs.Store over the `job` table migration 00012 creates.
//
// Its shape mirrors controlstore — a *sql.DB, one type, one file — so the
// dependency rule (backend-code-style.md §The dependency rule) is
// unchanged: the runner reaches into a domain-defined interface, and this
// package is the adapter beneath it. Unix seconds in and out; the store
// converts to/from time.Time so callers do not handle epoch arithmetic.
package jobstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
)

// Store adapts SQLite to jobs.Store.
type Store struct {
	db *sql.DB
}

// New returns a Store over db. The caller owns the handle and its
// lifetime.
func New(db *sql.DB) *Store {
	return &Store{db: db}
}

// Compile-time proof the shape here is the one the domain asked for.
var _ jobs.Store = (*Store)(nil)

// jobColumns is the read shape LatestForControl and ByID both share; kept
// as a constant so a schema change touches one place. Order matches
// scanJob below.
const jobColumns = "id, control_id, kind, status, COALESCE(error, ''), COALESCE(detail, ''), payload_json, created_at, started_at, finished_at, viewed_at"

// Insert creates a new job in `queued` and returns its id. createdAt
// is the runner's clock (unix seconds on the wire, matching every
// other table).
func (s *Store) Insert(ctx context.Context, j jobs.NewJob, createdAt time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx, `
        INSERT INTO job (control_id, kind, status, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)`,
		j.ControlID, string(j.Kind), string(jobs.StatusQueued),
		string(j.Payload), createdAt.Unix(),
	)
	if err != nil {
		return 0, fmt.Errorf("jobstore.Insert: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("jobstore.Insert: LastInsertId: %w", err)
	}
	return id, nil
}

// MarkRunning transitions a job from `queued` to `running` and stamps
// started_at. The `status = 'queued'` guard is belt-and-braces: the
// runner is a single goroutine so double-processing is impossible by
// design, but the WHERE clause turns any future concurrency mistake
// (a second Start goroutine, an accidental extra call) into a loud
// ErrJobNotFound instead of a silent status corruption (COR-3).
func (s *Store) MarkRunning(ctx context.Context, id int64, startedAt time.Time) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE job SET status = ?, started_at = ? WHERE id = ? AND status = ?`,
		string(jobs.StatusRunning), startedAt.Unix(), id, string(jobs.StatusQueued),
	)
	return checkOne(res, err, id, "MarkRunning")
}

// MarkDone transitions a job from `running` to `done` and stamps
// finished_at. Same status guard as MarkRunning; see that comment.
func (s *Store) MarkDone(ctx context.Context, id int64, finishedAt time.Time) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE job SET status = ?, finished_at = ? WHERE id = ? AND status = ?`,
		string(jobs.StatusDone), finishedAt.Unix(), id, string(jobs.StatusRunning),
	)
	return checkOne(res, err, id, "MarkDone")
}

// MarkFailed transitions a job from `running` to `failed` with a short
// error message and a long detail, and stamps finished_at. Same
// status guard as MarkRunning; see that comment.
func (s *Store) MarkFailed(ctx context.Context, id int64, msg, detail string, finishedAt time.Time) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE job SET status = ?, error = ?, detail = ?, finished_at = ? WHERE id = ? AND status = ?`,
		string(jobs.StatusFailed), msg, detail, finishedAt.Unix(), id, string(jobs.StatusRunning),
	)
	return checkOne(res, err, id, "MarkFailed")
}

// MarkDismissed stamps viewed_at. Idempotent (replaces the value).
func (s *Store) MarkDismissed(ctx context.Context, id int64, at time.Time) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE job SET viewed_at = ? WHERE id = ?`,
		at.Unix(), id,
	)
	return checkOne(res, err, id, "MarkDismissed")
}

// ByID returns one job, or ErrJobNotFound.
func (s *Store) ByID(ctx context.Context, id int64) (jobs.Job, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+jobColumns+` FROM job WHERE id = ?`, id)
	got, err := scanJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return jobs.Job{}, jobs.ErrJobNotFound
	}
	return got, err
}

// LatestForControl returns the most recent job for a control.
func (s *Store) LatestForControl(ctx context.Context, controlID string) (jobs.Job, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+jobColumns+` FROM job WHERE control_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
		controlID)
	got, err := scanJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return jobs.Job{}, jobs.ErrJobNotFound
	}
	return got, err
}

// QueuedIDs returns every queued job's id, oldest first.
func (s *Store) QueuedIDs(ctx context.Context) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id FROM job WHERE status = ? ORDER BY created_at ASC, id ASC`,
		string(jobs.StatusQueued))
	if err != nil {
		return nil, fmt.Errorf("jobstore.QueuedIDs: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("jobstore.QueuedIDs: scan: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("jobstore.QueuedIDs: rows: %w", err)
	}
	return ids, nil
}

// FailRunningWithMessage flips every running row to failed with the given
// short message. Returns the number of rows updated.
func (s *Store) FailRunningWithMessage(ctx context.Context, msg string, finishedAt time.Time) (int, error) {
	res, err := s.db.ExecContext(ctx,
		`UPDATE job SET status = ?, error = ?, finished_at = ? WHERE status = ?`,
		string(jobs.StatusFailed), msg, finishedAt.Unix(), string(jobs.StatusRunning),
	)
	if err != nil {
		return 0, fmt.Errorf("jobstore.FailRunningWithMessage: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("jobstore.FailRunningWithMessage: RowsAffected: %w", err)
	}
	return int(n), nil
}

// scanJob reads one row into a jobs.Job, converting nullable unix seconds
// back to *time.Time. The row is either a QueryRow result or one row of a
// Query result — both satisfy the same Scan contract.
type scanner interface {
	Scan(dest ...any) error
}

func scanJob(row scanner) (jobs.Job, error) {
	var (
		j                               jobs.Job
		kind, status, payload           string
		createdAt                       int64
		startedAt, finishedAt, viewedAt sql.NullInt64
		errMsg, detail                  string
	)
	if err := row.Scan(&j.ID, &j.ControlID, &kind, &status, &errMsg, &detail,
		&payload, &createdAt, &startedAt, &finishedAt, &viewedAt); err != nil {
		return jobs.Job{}, err
	}
	j.Kind = jobs.Kind(kind)
	j.Status = jobs.Status(status)
	j.Error = errMsg
	j.Detail = detail
	j.Payload = []byte(payload)
	j.CreatedAt = time.Unix(createdAt, 0)
	if startedAt.Valid {
		t := time.Unix(startedAt.Int64, 0)
		j.StartedAt = &t
	}
	if finishedAt.Valid {
		t := time.Unix(finishedAt.Int64, 0)
		j.FinishedAt = &t
	}
	if viewedAt.Valid {
		t := time.Unix(viewedAt.Int64, 0)
		j.ViewedAt = &t
	}
	return j, nil
}

// checkOne wraps the UPDATE-by-id family: an id that matches no row is
// ErrJobNotFound rather than a silent no-op.
func checkOne(res sql.Result, err error, id int64, op string) error {
	if err != nil {
		return fmt.Errorf("jobstore.%s: %w", op, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("jobstore.%s: RowsAffected: %w", op, err)
	}
	if n == 0 {
		return fmt.Errorf("jobstore.%s(%d): %w", op, id, jobs.ErrJobNotFound)
	}
	return nil
}
