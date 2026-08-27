package controlstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// Compile-time proof: the Store here also satisfies ReadingStore.
var _ controls.ReadingStore = (*Store)(nil)

// UpsertReadingsFromReport writes/updates the report against controlID.
// Overrides are left intact so a re-read at a different sensitivity does
// not wipe manual decisions (issue #167 §Reading with different thresholds).
func (s *Store) UpsertReadingsFromReport(ctx context.Context, controlID string, report controls.Report, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("controlstore.UpsertReadingsFromReport: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Sort the copy keys so the write order is deterministic. It is not
	// load-bearing today, but it removes a source of flake from tests
	// that assert the row-ordered result of a stream.
	keys := make([]string, 0, len(report.Copies))
	for k := range report.Copies {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, key := range keys {
		copyNumber, err := parseCopyNumber(key)
		if err != nil {
			return fmt.Errorf("controlstore.UpsertReadingsFromReport: %w", err)
		}
		reportCopy := report.Copies[key]

		readingID, err := upsertReading(ctx, tx, controlID, copyNumber, reportCopy, now)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM answer WHERE reading_id = ?`, readingID); err != nil {
			return fmt.Errorf("controlstore.UpsertReadingsFromReport: delete answers for reading %d: %w", readingID, err)
		}
		for _, ans := range reportCopy.Answers {
			markedJSON, err := json.Marshal(ans.Marked)
			if err != nil {
				return fmt.Errorf("controlstore.UpsertReadingsFromReport: encode marked: %w", err)
			}
			doubtfulJSON, err := json.Marshal(ans.Doubtful)
			if err != nil {
				return fmt.Errorf("controlstore.UpsertReadingsFromReport: encode doubtful: %w", err)
			}
			if ans.Name == "" {
				return fmt.Errorf("controlstore.UpsertReadingsFromReport: copy %d question %d has empty layout name — the wrapper cannot resolve it against the pool",
					copyNumber, ans.Question)
			}
			// #229: position is NULL when the analyzer sent 0 (no data)
			// and alternatives_json is NULL for a nil list. A NULL
			// position triggers loadAnswers' legacy ORDER BY fallback,
			// so a mixed-shape report cannot silently reorder rows that
			// had no position to begin with.
			var (
				positionVal     any
				alternativesVal any
			)
			if ans.Position > 0 {
				positionVal = ans.Position
			}
			if ans.Alternatives != nil {
				b, err := json.Marshal(ans.Alternatives)
				if err != nil {
					return fmt.Errorf("controlstore.UpsertReadingsFromReport: encode alternatives: %w", err)
				}
				alternativesVal = string(b)
			}
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO answer
                    (reading_id, question_ref, question_type, marked_json, doubtful_json, status, score, max, position, alternatives_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				readingID, ans.Name, string(ans.Type),
				string(markedJSON), string(doubtfulJSON),
				string(ans.Status), ans.Score, ans.Max,
				positionVal, alternativesVal,
			); err != nil {
				return fmt.Errorf("controlstore.UpsertReadingsFromReport: insert answer copy %d %s: %w",
					copyNumber, ans.Name, err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("controlstore.UpsertReadingsFromReport: commit: %w", err)
	}
	return nil
}

func upsertReading(ctx context.Context, tx *sql.Tx, controlID string, copyNumber int, c controls.ReportCopy, now time.Time) (int64, error) {
	var rutRead sql.NullString
	// The wire report carries what AMC pinned down in either case: eight
	// clean digits when RUTStatusOK, or the partial digits + `_` / `[…]`
	// sentinels from read_capture when RUTStatusUnreadable. Both are
	// stored verbatim — the review page shows what AMC saw beside the
	// professor's typed correction (§Reading with different thresholds).
	if c.RUT != "" {
		rutRead = sql.NullString{String: c.RUT, Valid: true}
	}
	// #243: pages_json is the physical scan pages AMC captured for this
	// copy. Persist verbatim from the report — the amcworker mapping
	// already substituted [1] for a legacy worker that did not emit the
	// field, so this write never records the empty-list shape a legacy
	// row was backfilled to '[1]' from.
	pages := c.Pages
	if pages == nil {
		pages = []int{}
	}
	pagesJSON, err := json.Marshal(pages)
	if err != nil {
		return 0, fmt.Errorf("controlstore.upsertReading: encode pages: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO reading (control_id, copy_number, rut_read, rut_status, copy_status, read_at, pages_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (control_id, copy_number) DO UPDATE SET
             rut_read = excluded.rut_read,
             rut_status = excluded.rut_status,
             copy_status = excluded.copy_status,
             read_at = excluded.read_at,
             pages_json = excluded.pages_json`,
		controlID, copyNumber, rutRead, string(c.RUTStatus), string(c.Status), now.Unix(), string(pagesJSON),
	); err != nil {
		return 0, fmt.Errorf("controlstore.upsertReading: %s/%d: %w", controlID, copyNumber, err)
	}
	var id int64
	if err := tx.QueryRowContext(ctx,
		`SELECT id FROM reading WHERE control_id = ? AND copy_number = ?`,
		controlID, copyNumber).Scan(&id); err != nil {
		return 0, fmt.Errorf("controlstore.upsertReading: lookup id %s/%d: %w", controlID, copyNumber, err)
	}
	return id, nil
}

// MarkMissingAsNotPresent inserts a not_present reading for every printed
// copia that has no reading yet. Idempotent.
func (s *Store) MarkMissingAsNotPresent(ctx context.Context, controlID string, now time.Time) error {
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO reading (control_id, copy_number, rut_read, rut_status, copy_status, read_at)
         SELECT c.control_id, c.numero, NULL, 'not_present', 'not_present', ?
         FROM copia c
         WHERE c.control_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM reading r
             WHERE r.control_id = c.control_id AND r.copy_number = c.numero
           )`,
		now.Unix(), controlID); err != nil {
		return fmt.Errorf("controlstore.MarkMissingAsNotPresent: %w", err)
	}
	return nil
}

// ReadingsByControl returns every reading for a control, ordered by
// copy_number ascending, with overrides eagerly attached.
func (s *Store) ReadingsByControl(ctx context.Context, controlID string) ([]controls.Reading, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT id, control_id, copy_number, rut_read, rut_status, copy_status, read_at, last_edited_at, pages_json
        FROM reading
        WHERE control_id = ?
        ORDER BY copy_number ASC`, controlID)
	if err != nil {
		return nil, fmt.Errorf("controlstore.ReadingsByControl: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var readings []controls.Reading
	for rows.Next() {
		r, err := scanReading(rows)
		if err != nil {
			return nil, fmt.Errorf("controlstore.ReadingsByControl: scan: %w", err)
		}
		readings = append(readings, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("controlstore.ReadingsByControl: iterate: %w", err)
	}
	if err := s.attachAnswersAndOverrides(ctx, readings); err != nil {
		return nil, err
	}
	return readings, nil
}

// ReadingByCopy returns one reading (with overrides), or
// ErrReadingNotFound.
func (s *Store) ReadingByCopy(ctx context.Context, controlID string, copyNumber int) (controls.Reading, error) {
	row := s.db.QueryRowContext(ctx, `
        SELECT id, control_id, copy_number, rut_read, rut_status, copy_status, read_at, last_edited_at, pages_json
        FROM reading
        WHERE control_id = ? AND copy_number = ?`, controlID, copyNumber)
	r, err := scanReading(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return controls.Reading{}, controls.ErrReadingNotFound
		}
		return controls.Reading{}, fmt.Errorf("controlstore.ReadingByCopy: %w", err)
	}
	readings := []controls.Reading{r}
	if err := s.attachAnswersAndOverrides(ctx, readings); err != nil {
		return controls.Reading{}, err
	}
	return readings[0], nil
}

func (s *Store) attachAnswersAndOverrides(ctx context.Context, readings []controls.Reading) error {
	if len(readings) == 0 {
		return nil
	}
	// One pass per reading — simpler than one big IN () join, and the
	// reading count is bounded by the copy count, which is bounded by
	// maxCopies (300 today). If that ever becomes a problem the read
	// shape here changes without moving the interface.
	for i := range readings {
		if err := s.loadAnswers(ctx, &readings[i]); err != nil {
			return err
		}
		if err := s.loadRUTOverride(ctx, &readings[i]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) loadAnswers(ctx context.Context, r *controls.Reading) error {
	// #229: order by position when it is set, and fall back to
	// question_ref for legacy rows written before the position column
	// existed. `position IS NULL` sorts new rows (has position) first
	// under SQLite's default (false < true = 0 < 1). Answers with a
	// position come out in the order the student saw them on the paper;
	// answers without one keep the pre-#229 alphabetical order.
	rows, err := s.db.QueryContext(ctx, `
        SELECT a.question_ref, a.question_type, a.marked_json, a.doubtful_json, a.status, a.score, a.max,
               a.position, a.alternatives_json,
               o.marked_json, o.status, o.edited_at
        FROM answer a
        LEFT JOIN answer_override o ON o.reading_id = a.reading_id AND o.question_ref = a.question_ref
        WHERE a.reading_id = ?
        ORDER BY a.position IS NULL, a.position ASC, a.question_ref ASC`, r.ID)
	if err != nil {
		return fmt.Errorf("controlstore.loadAnswers: reading %d: %w", r.ID, err)
	}
	defer func() { _ = rows.Close() }()

	r.Answers = nil
	for rows.Next() {
		var (
			a                controls.Answer
			qtype            string
			markedJSON       string
			doubtfulJSON     string
			status           string
			positionRaw      sql.NullInt64
			alternativesJSON sql.NullString
			ovMarkedJSON     sql.NullString
			ovStatus         sql.NullString
			ovEditedAtRaw    sql.NullInt64
		)
		if err := rows.Scan(
			&a.QuestionRef, &qtype, &markedJSON, &doubtfulJSON, &status, &a.Score, &a.Max,
			&positionRaw, &alternativesJSON,
			&ovMarkedJSON, &ovStatus, &ovEditedAtRaw,
		); err != nil {
			return fmt.Errorf("controlstore.loadAnswers: scan: %w", err)
		}
		a.QuestionType = controls.QuestionType(qtype)
		a.Status = controls.AnswerStatus(status)
		if err := json.Unmarshal([]byte(markedJSON), &a.Marked); err != nil {
			return fmt.Errorf("controlstore.loadAnswers: decode marked: %w", err)
		}
		if err := json.Unmarshal([]byte(doubtfulJSON), &a.Doubtful); err != nil {
			return fmt.Errorf("controlstore.loadAnswers: decode doubtful: %w", err)
		}
		if positionRaw.Valid {
			a.Position = int(positionRaw.Int64)
		}
		if alternativesJSON.Valid {
			if err := json.Unmarshal([]byte(alternativesJSON.String), &a.Alternatives); err != nil {
				return fmt.Errorf("controlstore.loadAnswers: decode alternatives: %w", err)
			}
		}
		if ovMarkedJSON.Valid {
			ov := controls.AnswerOverride{
				Status:   controls.AnswerStatus(ovStatus.String),
				EditedAt: time.Unix(ovEditedAtRaw.Int64, 0).UTC(),
			}
			if err := json.Unmarshal([]byte(ovMarkedJSON.String), &ov.Marked); err != nil {
				return fmt.Errorf("controlstore.loadAnswers: decode override marked: %w", err)
			}
			a.Override = &ov
		}
		r.Answers = append(r.Answers, a)
	}
	return rows.Err()
}

func (s *Store) loadRUTOverride(ctx context.Context, r *controls.Reading) error {
	var (
		rut         string
		editedAt    int64
		hasOverride bool
	)
	row := s.db.QueryRowContext(ctx,
		`SELECT rut, edited_at FROM rut_override WHERE reading_id = ?`, r.ID)
	switch err := row.Scan(&rut, &editedAt); err {
	case nil:
		hasOverride = true
	case sql.ErrNoRows:
	default:
		return fmt.Errorf("controlstore.loadRUTOverride: reading %d: %w", r.ID, err)
	}
	if hasOverride {
		r.RUTOverride = &controls.RUTOverride{
			RUT:      rut,
			EditedAt: time.Unix(editedAt, 0).UTC(),
		}
	}
	return nil
}

// SetAnswerOverride upserts an override for one (reading_id,
// question_ref) and stamps the reading's last_edited_at.
func (s *Store) SetAnswerOverride(ctx context.Context, readingID int64, questionRef string, override controls.AnswerOverride) error {
	markedJSON, err := json.Marshal(override.Marked)
	if err != nil {
		return fmt.Errorf("controlstore.SetAnswerOverride: encode marked: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("controlstore.SetAnswerOverride: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO answer_override (reading_id, question_ref, marked_json, status, edited_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (reading_id, question_ref) DO UPDATE SET
             marked_json = excluded.marked_json,
             status      = excluded.status,
             edited_at   = excluded.edited_at`,
		readingID, questionRef, string(markedJSON), string(override.Status), override.EditedAt.Unix(),
	); err != nil {
		return fmt.Errorf("controlstore.SetAnswerOverride: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE reading SET last_edited_at = ? WHERE id = ?`,
		override.EditedAt.Unix(), readingID); err != nil {
		return fmt.Errorf("controlstore.SetAnswerOverride: stamp: %w", err)
	}
	return tx.Commit()
}

// ClearAnswerOverride deletes the override for (reading_id, question_ref).
func (s *Store) ClearAnswerOverride(ctx context.Context, readingID int64, questionRef string) error {
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM answer_override WHERE reading_id = ? AND question_ref = ?`,
		readingID, questionRef); err != nil {
		return fmt.Errorf("controlstore.ClearAnswerOverride: %w", err)
	}
	return nil
}

// SetRUTOverride upserts the RUT override.
func (s *Store) SetRUTOverride(ctx context.Context, readingID int64, rut string, editedAt time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("controlstore.SetRUTOverride: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO rut_override (reading_id, rut, edited_at)
         VALUES (?, ?, ?)
         ON CONFLICT (reading_id) DO UPDATE SET
             rut = excluded.rut,
             edited_at = excluded.edited_at`,
		readingID, rut, editedAt.Unix()); err != nil {
		return fmt.Errorf("controlstore.SetRUTOverride: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE reading SET last_edited_at = ? WHERE id = ?`,
		editedAt.Unix(), readingID); err != nil {
		return fmt.Errorf("controlstore.SetRUTOverride: stamp: %w", err)
	}
	return tx.Commit()
}

// ClearRUTOverride deletes the RUT override.
func (s *Store) ClearRUTOverride(ctx context.Context, readingID int64) error {
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM rut_override WHERE reading_id = ?`, readingID); err != nil {
		return fmt.Errorf("controlstore.ClearRUTOverride: %w", err)
	}
	return nil
}

// SetControlState updates control.state.
func (s *Store) SetControlState(ctx context.Context, controlID string, state controls.State) error {
	result, err := s.db.ExecContext(ctx,
		`UPDATE control SET state = ? WHERE id = ?`, string(state), controlID)
	if err != nil {
		return fmt.Errorf("controlstore.SetControlState: %w", err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("controlstore.SetControlState: rows affected: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("controlstore.SetControlState: %s: %w", controlID, controls.ErrControlNotFound)
	}
	return nil
}

func scanReading(row interface{ Scan(...any) error }) (controls.Reading, error) {
	var (
		r               controls.Reading
		rutRead         sql.NullString
		rutStatus       string
		copyStatus      string
		readAt          int64
		lastEditedAtRaw sql.NullInt64
		pagesJSON       string
	)
	if err := row.Scan(&r.ID, &r.ControlID, &r.CopyNumber, &rutRead, &rutStatus, &copyStatus, &readAt, &lastEditedAtRaw, &pagesJSON); err != nil {
		return controls.Reading{}, err
	}
	r.RUTStatus = controls.RUTStatus(rutStatus)
	r.CopyStatus = controls.CopyStatus(copyStatus)
	r.ReadAt = time.Unix(readAt, 0).UTC()
	if rutRead.Valid {
		s := rutRead.String
		r.RUTRead = &s
	}
	if lastEditedAtRaw.Valid {
		t := time.Unix(lastEditedAtRaw.Int64, 0).UTC()
		r.LastEditedAt = &t
	}
	// #243: pages_json is NOT NULL under migration 00011; a legacy row
	// was backfilled to '[1]', a new write from a legacy worker landed
	// as '[1]' via the amcworker fallback, and a new write from the
	// current worker carries the AMC-captured list. Empty '[]' decodes
	// to nil — the handler treats that identically to "no pages known"
	// and lets the raw-scan fallback render nothing rather than an
	// invented page 1 (COR: the domain does not silently paper over
	// what the schema says is empty).
	if pagesJSON != "" {
		if err := json.Unmarshal([]byte(pagesJSON), &r.Pages); err != nil {
			return controls.Reading{}, fmt.Errorf("controlstore.scanReading: decode pages: %w", err)
		}
	}
	return r, nil
}

func parseCopyNumber(key string) (int, error) {
	n, err := strconv.Atoi(key)
	if err != nil {
		return 0, fmt.Errorf("copy key %q is not a number: %w", key, err)
	}
	if n < 1 {
		return 0, fmt.Errorf("copy key %q must be positive", key)
	}
	return n, nil
}
