// Package controlstore is the SQLite side of the controls domain: one type
// implementing controls.Store over the tables migration 00004 creates.
//
// It lives under internal/infra/storage because that is where store
// implementations live (backend-code-style.md §The dependency rule), and in
// its own package so that storage itself stays about opening a database and
// applying migrations. It names no driver: it takes a *sql.DB, which is what
// keeps the Postgres exit of ADR-0007 a change in one package.
package controlstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// Store adapts SQLite to controls.Store. One type rather than three; the
// domain sees the narrow interface it asked for.
type Store struct {
	db *sql.DB
}

// New returns a Store over db. The caller owns the handle and its lifetime.
func New(db *sql.DB) *Store {
	return &Store{db: db}
}

// Compile-time proof the shape here is the one the domain asked for.
var _ controls.Store = (*Store)(nil)

// controlInsertColumns is what CreateControl writes: everything except
// deleted_at, which lands NULL by default (a fresh control is active by
// definition; issue #261).
const controlInsertColumns = "id, name, application_date, from_document, from_section, to_document, to_section, questions_per_copy, copies, duplex_padding, paper, ticked, unsure, state, created_at, created_by"

// controlColumns is what SELECTs read, including deleted_at so the
// archived/active split is visible to callers.
const controlColumns = controlInsertColumns + ", deleted_at"

// CreateControl writes the control, its pool and its copies in one
// transaction. Rolled back on any failure so a control never appears in the
// list with an empty pool or without its copy rows — the "all-or-nothing"
// promise the Service (§Failure modes) is built on.
func (s *Store) CreateControl(ctx context.Context, control controls.Control, pool []controls.PoolEntry) error {
	if control.Copies <= 0 {
		return fmt.Errorf("controlstore.CreateControl: copies must be > 0, got %d", control.Copies)
	}
	if len(pool) == 0 {
		return fmt.Errorf("controlstore.CreateControl: pool is empty for %s", control.ID)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("controlstore.CreateControl: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
        INSERT INTO control (`+controlInsertColumns+`)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		control.ID,
		control.Name,
		nullableUnixSeconds(control.ApplicationDate),
		control.RangeFrom.Document, control.RangeFrom.Section,
		control.RangeTo.Document, control.RangeTo.Section,
		control.QuestionsPerCopy, control.Copies,
		boolToInt(control.DuplexPadding),
		string(control.Paper),
		control.Ticked, control.Unsure,
		string(control.State),
		control.CreatedAt.Unix(),
		control.CreatedBy,
	); err != nil {
		return fmt.Errorf("controlstore.CreateControl: insert control %s: %w", control.ID, err)
	}

	for _, entry := range pool {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO control_pregunta (control_id, pregunta_ref, orden) VALUES (?, ?, ?)`,
			control.ID, entry.Ref, entry.Order,
		); err != nil {
			return fmt.Errorf("controlstore.CreateControl: insert pool entry %s/%s: %w",
				control.ID, entry.Ref, err)
		}
	}

	for i := 1; i <= control.Copies; i++ {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO copia (control_id, numero) VALUES (?, ?)`,
			control.ID, i,
		); err != nil {
			return fmt.Errorf("controlstore.CreateControl: insert copy %s/%d: %w",
				control.ID, i, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("controlstore.CreateControl: commit %s: %w", control.ID, err)
	}
	return nil
}

// ControlByID reads one control back.
func (s *Store) ControlByID(ctx context.Context, id string) (controls.Control, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+controlColumns+" FROM control WHERE id = ?", id)
	c, err := scanControl(row)
	if err != nil {
		return controls.Control{}, notFound(err, fmt.Sprintf("read control %s", id))
	}
	return c, nil
}

// ListControls returns every ACTIVE control, ordered by application date
// descending with NULLs last, then by created_at descending as a tie-breaker.
// Archived controls (deleted_at IS NOT NULL, issue #261) are hidden here and
// surfaced only via ListArchivedControls — that split is what makes /controls
// stay uncluttered while an operator's test controls accumulate.
func (s *Store) ListControls(ctx context.Context) ([]controls.Control, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT `+controlColumns+`
        FROM control
        WHERE deleted_at IS NULL
        ORDER BY application_date IS NULL, application_date DESC, created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("controlstore.ListControls: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []controls.Control
	for rows.Next() {
		c, err := scanControl(rows)
		if err != nil {
			return nil, fmt.Errorf("controlstore.ListControls: scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("controlstore.ListControls: iterate: %w", err)
	}
	return out, nil
}

// ListArchivedControls returns every archived control (deleted_at IS NOT
// NULL), ordered by deleted_at descending so the most recently archived is
// on top of /controls/archived (issue #261). The idx_control_deleted_at
// index (migration 00013) covers both the WHERE and the ORDER BY.
func (s *Store) ListArchivedControls(ctx context.Context) ([]controls.Control, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT `+controlColumns+`
        FROM control
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("controlstore.ListArchivedControls: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []controls.Control
	for rows.Next() {
		c, err := scanControl(rows)
		if err != nil {
			return nil, fmt.Errorf("controlstore.ListArchivedControls: scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("controlstore.ListArchivedControls: iterate: %w", err)
	}
	return out, nil
}

// SoftDeleteControl stamps deleted_at, hiding the control from ListControls
// while keeping every downstream row intact — the runner (issue #249) keeps
// processing an in-flight job because nothing about the row moves (issue
// #261 §Async runner interaction). Idempotent by guard: a second call on an
// already-archived row updates 0 rows and returns ErrControlNotFound.
func (s *Store) SoftDeleteControl(ctx context.Context, id string, at time.Time) error {
	result, err := s.db.ExecContext(ctx,
		`UPDATE control SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
		at.Unix(), id,
	)
	if err != nil {
		return fmt.Errorf("controlstore.SoftDeleteControl %s: %w", id, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("controlstore.SoftDeleteControl %s: rows affected: %w", id, err)
	}
	if affected == 0 {
		return fmt.Errorf("controlstore.SoftDeleteControl %s: %w", id, controls.ErrControlNotFound)
	}
	return nil
}

// RestoreControl clears deleted_at, returning the control to ListControls.
// Symmetric guard to SoftDeleteControl: only fires on rows with deleted_at
// IS NOT NULL, so a call on an already-active control updates 0 rows and
// returns ErrControlNotFound.
func (s *Store) RestoreControl(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx,
		`UPDATE control SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`,
		id,
	)
	if err != nil {
		return fmt.Errorf("controlstore.RestoreControl %s: %w", id, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("controlstore.RestoreControl %s: rows affected: %w", id, err)
	}
	if affected == 0 {
		return fmt.Errorf("controlstore.RestoreControl %s: %w", id, controls.ErrControlNotFound)
	}
	return nil
}

// PurgeControl hard-deletes an archived control (issue #261). Refuses to
// touch an active row via the AND deleted_at IS NOT NULL guard — the
// schema-level belt behind Service.Purge's ControlByID gate. Cascade
// removes control_pregunta, copia, reading, answer, annotated_copy and job
// rows (ADR-0034 §Consequences).
func (s *Store) PurgeControl(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx,
		`DELETE FROM control WHERE id = ? AND deleted_at IS NOT NULL`, id,
	)
	if err != nil {
		return fmt.Errorf("controlstore.PurgeControl %s: %w", id, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("controlstore.PurgeControl %s: rows affected: %w", id, err)
	}
	if affected == 0 {
		return fmt.Errorf("controlstore.PurgeControl %s: %w", id, controls.ErrControlNotFound)
	}
	return nil
}

// ControlPool returns the pool for a control, in the order it was drawn.
func (s *Store) ControlPool(ctx context.Context, controlID string) ([]controls.PoolEntry, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT pregunta_ref, orden FROM control_pregunta
        WHERE control_id = ?
        ORDER BY orden ASC`, controlID)
	if err != nil {
		return nil, fmt.Errorf("controlstore.ControlPool: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []controls.PoolEntry
	for rows.Next() {
		var e controls.PoolEntry
		if err := rows.Scan(&e.Ref, &e.Order); err != nil {
			return nil, fmt.Errorf("controlstore.ControlPool: scan: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("controlstore.ControlPool: iterate: %w", err)
	}
	return out, nil
}

// scanControl reads controlColumns in order.
func scanControl(row interface{ Scan(...any) error }) (controls.Control, error) {
	var (
		c               controls.Control
		applicationDate sql.NullInt64
		duplexPadding   int
		paper           string
		createdAt       int64
		state           string
		deletedAt       sql.NullInt64
	)
	if err := row.Scan(
		&c.ID, &c.Name, &applicationDate,
		&c.RangeFrom.Document, &c.RangeFrom.Section,
		&c.RangeTo.Document, &c.RangeTo.Section,
		&c.QuestionsPerCopy, &c.Copies,
		&duplexPadding,
		&paper,
		&c.Ticked, &c.Unsure,
		&state, &createdAt, &c.CreatedBy,
		&deletedAt,
	); err != nil {
		return controls.Control{}, err
	}
	c.DuplexPadding = duplexPadding != 0
	c.Paper = controls.Paper(paper)
	c.State = controls.State(state)
	c.CreatedAt = time.Unix(createdAt, 0).UTC()
	if applicationDate.Valid {
		at := time.Unix(applicationDate.Int64, 0).UTC()
		c.ApplicationDate = &at
	}
	if deletedAt.Valid {
		at := time.Unix(deletedAt.Int64, 0).UTC()
		c.DeletedAt = &at
	}
	return c, nil
}

// boolToInt is the SQLite convention: 0 for false, 1 for true.
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// notFound turns database/sql's absence sentinel into the domain's.
func notFound(err error, subject string) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%s: %w", subject, controls.ErrControlNotFound)
	}
	return fmt.Errorf("%s: %w", subject, err)
}

// nullableUnixSeconds turns *time.Time into a sql.NullInt64 for the
// application_date column. Nil times become NULL.
func nullableUnixSeconds(t *time.Time) sql.NullInt64 {
	if t == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: t.Unix(), Valid: true}
}

// RecordAnnotated writes the anotado PDF record for one copia. Idempotent
// UPSERT on (control_id, copy_number) — the same copia re-annotated in the
// review page replaces its row rather than growing history (issue #190).
func (s *Store) RecordAnnotated(ctx context.Context, a controls.AnnotatedCopy) error {
	if _, err := s.db.ExecContext(ctx, `
        INSERT INTO annotated_copy (control_id, copy_number, generated_at, path)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (control_id, copy_number) DO UPDATE SET
            generated_at = excluded.generated_at,
            path         = excluded.path`,
		a.ControlID, a.CopyNumber, a.GeneratedAt.Unix(), a.Path,
	); err != nil {
		return fmt.Errorf("controlstore.RecordAnnotated %s/%d: %w",
			a.ControlID, a.CopyNumber, err)
	}
	return nil
}

// AnnotatedByCopy reads back one anotado record. exists=false when the copia
// has never been annotated — the review page falls back to the raw scan
// (issue #190).
func (s *Store) AnnotatedByCopy(ctx context.Context, controlID string, copyNumber int) (controls.AnnotatedCopy, bool, error) {
	var (
		a         controls.AnnotatedCopy
		generated int64
	)
	err := s.db.QueryRowContext(ctx, `
        SELECT control_id, copy_number, generated_at, path
        FROM annotated_copy
        WHERE control_id = ? AND copy_number = ?`,
		controlID, copyNumber,
	).Scan(&a.ControlID, &a.CopyNumber, &generated, &a.Path)
	if errors.Is(err, sql.ErrNoRows) {
		return controls.AnnotatedCopy{}, false, nil
	}
	if err != nil {
		return controls.AnnotatedCopy{}, false, fmt.Errorf(
			"controlstore.AnnotatedByCopy %s/%d: %w", controlID, copyNumber, err)
	}
	a.GeneratedAt = time.Unix(generated, 0).UTC()
	return a, true, nil
}

// SetControlThresholds persists the darkness pair a batch was read at
// (issue #197). Last-wins: each upload and each reanalyse writes the pair
// it used, and Annotate reads it back so the PDFs agree.
func (s *Store) SetControlThresholds(ctx context.Context, controlID string, ticked, unsure float64) error {
	if _, err := s.db.ExecContext(ctx,
		`UPDATE control SET ticked = ?, unsure = ? WHERE id = ?`,
		ticked, unsure, controlID,
	); err != nil {
		return fmt.Errorf("controlstore.SetControlThresholds %s: %w", controlID, err)
	}
	return nil
}

// ClearAnnotated deletes every anotado record for a control — the review
// page then falls back to the raw scan everywhere (issue #190: Reanalyze
// invalidates drawings made at the previous thresholds).
func (s *Store) ClearAnnotated(ctx context.Context, controlID string) error {
	if _, err := s.db.ExecContext(ctx, `
        DELETE FROM annotated_copy WHERE control_id = ?`, controlID); err != nil {
		return fmt.Errorf("controlstore.ClearAnnotated %s: %w", controlID, err)
	}
	return nil
}
