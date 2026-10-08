package surveystore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// What a run's scans produced (issue #311, migration 00025).

// detected is survey_review_item.detected on disk.
type detected struct {
	Marked   []int64 `json:"marked"`
	Doubtful []int64 `json:"doubtful"`
}

// SaveReadings stores one batch's reading; the Store port's comment is
// the contract.
func (s *Store) SaveReadings(ctx context.Context, runID int64, recaptured []int, copies []survey.CopyReading) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("surveystore.SaveReadings: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// The run may have been closed while the worker read the batch (#311
	// review, COR-4): a closed run takes no reading, decided in the write.
	var state string
	if err := tx.QueryRowContext(ctx, `SELECT state FROM survey_run WHERE id = ?`, runID).Scan(&state); err != nil {
		return fmt.Errorf("surveystore.SaveReadings: run %d: %w", runID, err)
	}
	if survey.RunState(state) != survey.RunOpen {
		return fmt.Errorf("surveystore.SaveReadings: run %d: %w", runID, survey.ErrRunNotOpen)
	}

	for _, n := range recaptured {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM survey_copy WHERE run_id = ? AND copy_number = ?`, runID, n); err != nil {
			return fmt.Errorf("surveystore.SaveReadings: resetting copy %d: %w", n, err)
		}
	}
	for _, c := range copies {
		pages, err := json.Marshal(c.Pages)
		if err != nil {
			return fmt.Errorf("surveystore.SaveReadings: copy %d's pages: %w", c.CopyNumber, err)
		}
		var copyID int64
		if err := tx.QueryRowContext(ctx, `
            INSERT INTO survey_copy (run_id, copy_number, pages_json) VALUES (?, ?, ?)
            ON CONFLICT (run_id, copy_number) DO UPDATE SET pages_json = excluded.pages_json
            RETURNING id`, runID, c.CopyNumber, string(pages)).Scan(&copyID); err != nil {
			return fmt.Errorf("surveystore.SaveReadings: copy %d: %w", c.CopyNumber, err)
		}
		// Every batch re-reports the whole project, and a copy can GROW
		// between batches without being re-captured (its second page
		// arrives later, #311 review COR-1). So what is still undecided is
		// re-read every time; a question the professor already decided keeps
		// its decision and its marks.
		decided := map[int64]bool{}
		rows, err := tx.QueryContext(ctx,
			`SELECT question_id FROM survey_review_item WHERE copy_id = ? AND resolution IS NOT NULL`, copyID)
		if err != nil {
			return fmt.Errorf("surveystore.SaveReadings: copy %d's decisions: %w", c.CopyNumber, err)
		}
		for rows.Next() {
			var q int64
			if err := rows.Scan(&q); err != nil {
				_ = rows.Close()
				return fmt.Errorf("surveystore.SaveReadings: copy %d's decisions: %w", c.CopyNumber, err)
			}
			decided[q] = true
		}
		_ = rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("surveystore.SaveReadings: copy %d's decisions: %w", c.CopyNumber, err)
		}
		// The same predicate as `decided` above, in SQL: the two must agree.
		if _, err := tx.ExecContext(ctx, `
            DELETE FROM survey_mark WHERE copy_id = ? AND question_id NOT IN
                (SELECT question_id FROM survey_review_item WHERE copy_id = ? AND resolution IS NOT NULL)`,
			copyID, copyID); err != nil {
			return fmt.Errorf("surveystore.SaveReadings: copy %d: clearing undecided marks: %w", c.CopyNumber, err)
		}
		for _, m := range c.Marks {
			if decided[m.QuestionID] {
				continue
			}
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO survey_mark (copy_id, question_id, alternative_id) VALUES (?, ?, ?)`,
				copyID, m.QuestionID, m.AlternativeID); err != nil {
				return fmt.Errorf("surveystore.SaveReadings: copy %d, question %d: %w", c.CopyNumber, m.QuestionID, err)
			}
		}
		// A pending item is refreshed IN PLACE, keyed by its question: its id
		// is what a review page opened before this batch will post (#311
		// review recheck, COR-NEW-1). One the new reading no longer flags
		// goes.
		flagged := map[int64]bool{}
		for _, it := range c.Items {
			if decided[it.QuestionID] {
				continue
			}
			flagged[it.QuestionID] = true
			seen, err := json.Marshal(detected{Marked: nonNil(it.Marked), Doubtful: nonNil(it.Doubtful)})
			if err != nil {
				return fmt.Errorf("surveystore.SaveReadings: copy %d's item: %w", c.CopyNumber, err)
			}
			if _, err := tx.ExecContext(ctx, `
                INSERT INTO survey_review_item (copy_id, question_id, reason, detected) VALUES (?, ?, ?, ?)
                ON CONFLICT (copy_id, question_id) DO UPDATE SET reason = excluded.reason, detected = excluded.detected
                WHERE survey_review_item.resolution IS NULL`,
				copyID, it.QuestionID, string(it.Reason), string(seen)); err != nil {
				return fmt.Errorf("surveystore.SaveReadings: copy %d, item on question %d: %w", c.CopyNumber, it.QuestionID, err)
			}
		}
		stale, err := tx.QueryContext(ctx,
			`SELECT id, question_id FROM survey_review_item WHERE copy_id = ? AND resolution IS NULL`, copyID)
		if err != nil {
			return fmt.Errorf("surveystore.SaveReadings: copy %d's pending items: %w", c.CopyNumber, err)
		}
		var gone []int64
		for stale.Next() {
			var id, q int64
			if err := stale.Scan(&id, &q); err != nil {
				_ = stale.Close()
				return fmt.Errorf("surveystore.SaveReadings: copy %d's pending items: %w", c.CopyNumber, err)
			}
			if !flagged[q] {
				gone = append(gone, id)
			}
		}
		_ = stale.Close()
		if err := stale.Err(); err != nil {
			return fmt.Errorf("surveystore.SaveReadings: copy %d's pending items: %w", c.CopyNumber, err)
		}
		for _, id := range gone {
			if _, err := tx.ExecContext(ctx, `DELETE FROM survey_review_item WHERE id = ?`, id); err != nil {
				return fmt.Errorf("surveystore.SaveReadings: copy %d: dropping item %d: %w", c.CopyNumber, id, err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("surveystore.SaveReadings: commit: %w", err)
	}
	return nil
}

func nonNil(ids []int64) []int64 {
	if ids == nil {
		return []int64{}
	}
	return ids
}

// ReadingCounts is one aggregate over the run's copies.
func (s *Store) ReadingCounts(ctx context.Context, runID int64) (survey.ReadingCounts, error) {
	var c survey.ReadingCounts
	err := s.db.QueryRowContext(ctx, `
        SELECT count(*),
               coalesce(sum(p.items > 0), 0),
               coalesce(sum(p.items), 0)
        FROM survey_copy c
        LEFT JOIN (SELECT copy_id, count(*) AS items FROM survey_review_item
                   WHERE resolution IS NULL GROUP BY copy_id) p ON p.copy_id = c.id
        WHERE c.run_id = ?`, runID).Scan(&c.Copies, &c.PendingCopies, &c.PendingItems)
	if err != nil {
		return survey.ReadingCounts{}, fmt.Errorf("surveystore.ReadingCounts for run %d: %w", runID, err)
	}
	return c, nil
}

// CopyByNumber returns one read copy of the run.
func (s *Store) CopyByNumber(ctx context.Context, runID int64, copyNumber int) (survey.Copy, error) {
	c := survey.Copy{RunID: runID, CopyNumber: copyNumber}
	var pages string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, pages_json FROM survey_copy WHERE run_id = ? AND copy_number = ?`, runID, copyNumber,
	).Scan(&c.ID, &pages)
	if errors.Is(err, sql.ErrNoRows) {
		return survey.Copy{}, fmt.Errorf("surveystore.CopyByNumber: run %d copy %d: %w", runID, copyNumber, survey.ErrCopyNotFound)
	}
	if err != nil {
		return survey.Copy{}, fmt.Errorf("surveystore.CopyByNumber: run %d copy %d: %w", runID, copyNumber, err)
	}
	if err := json.Unmarshal([]byte(pages), &c.Pages); err != nil {
		return survey.Copy{}, fmt.Errorf("surveystore.CopyByNumber: run %d copy %d's pages: %w", runID, copyNumber, err)
	}
	return c, nil
}

// MarksForCopy returns the copy's marks, by question then alternative.
func (s *Store) MarksForCopy(ctx context.Context, copyID int64) ([]survey.Mark, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT question_id, alternative_id FROM survey_mark
        WHERE copy_id = ? ORDER BY question_id, alternative_id`, copyID)
	if err != nil {
		return nil, fmt.Errorf("surveystore.MarksForCopy %d: %w", copyID, err)
	}
	defer func() { _ = rows.Close() }()
	var out []survey.Mark
	for rows.Next() {
		var m survey.Mark
		if err := rows.Scan(&m.QuestionID, &m.AlternativeID); err != nil {
			return nil, fmt.Errorf("surveystore.MarksForCopy %d: %w", copyID, err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

const itemColumns = `i.id, i.copy_id, c.copy_number, i.question_id, i.reason, i.detected,
                     coalesce(i.resolution, ''), i.comment, i.resolved_at, i.resolved_by`

// ItemsForCopy returns the copy's review items, in question id order.
func (s *Store) ItemsForCopy(ctx context.Context, copyID int64) ([]survey.ReviewItem, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT `+itemColumns+`
        FROM survey_review_item i JOIN survey_copy c ON c.id = i.copy_id
        WHERE i.copy_id = ? ORDER BY i.question_id`, copyID)
	if err != nil {
		return nil, fmt.Errorf("surveystore.ItemsForCopy %d: %w", copyID, err)
	}
	defer func() { _ = rows.Close() }()
	var out []survey.ReviewItem
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, fmt.Errorf("surveystore.ItemsForCopy %d: %w", copyID, err)
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func scanItem(row scanner) (survey.ReviewItem, error) {
	var (
		it         survey.ReviewItem
		reason     string
		seen       string
		resolution string
		resolvedAt sql.NullInt64
		resolvedBy sql.NullInt64
	)
	if err := row.Scan(&it.ID, &it.CopyID, &it.CopyNumber, &it.QuestionID, &reason, &seen,
		&resolution, &it.Comment, &resolvedAt, &resolvedBy); err != nil {
		return survey.ReviewItem{}, err
	}
	var d detected
	if err := json.Unmarshal([]byte(seen), &d); err != nil {
		return survey.ReviewItem{}, fmt.Errorf("item %d's detected marks: %w", it.ID, err)
	}
	it.Reason = survey.ReviewReason(reason)
	it.Marked, it.Doubtful = d.Marked, d.Doubtful
	it.Resolution = survey.Resolution(resolution)
	if resolvedAt.Valid {
		at := time.Unix(resolvedAt.Int64, 0).UTC()
		it.ResolvedAt = &at
	}
	if resolvedBy.Valid {
		by := resolvedBy.Int64
		it.ResolvedBy = &by
	}
	return it, nil
}

// PendingCopyNumbers returns the run's copies with an item still pending.
func (s *Store) PendingCopyNumbers(ctx context.Context, runID int64) ([]int, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT DISTINCT c.copy_number
        FROM survey_copy c JOIN survey_review_item i ON i.copy_id = c.id
        WHERE c.run_id = ? AND i.resolution IS NULL
        ORDER BY c.copy_number`, runID)
	if err != nil {
		return nil, fmt.Errorf("surveystore.PendingCopyNumbers for run %d: %w", runID, err)
	}
	defer func() { _ = rows.Close() }()
	var out []int
	for rows.Next() {
		var n int
		if err := rows.Scan(&n); err != nil {
			return nil, fmt.Errorf("surveystore.PendingCopyNumbers for run %d: %w", runID, err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// ResolveItems records one copy's decisions; the Store port's comment is
// the contract.
func (s *Store) ResolveItems(ctx context.Context, runID, copyID int64, decisions []survey.ItemResolution, by int64, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("surveystore.ResolveItems: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// The run's state, read in the write: a run closed or cancelled
	// concurrently cannot take a decision after the fact.
	var state string
	err = tx.QueryRowContext(ctx, `
        SELECT r.state FROM survey_run r JOIN survey_copy c ON c.run_id = r.id
        WHERE r.id = ? AND c.id = ?`, runID, copyID).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("surveystore.ResolveItems: copy %d of run %d: %w", copyID, runID, survey.ErrCopyNotFound)
	}
	if err != nil {
		return fmt.Errorf("surveystore.ResolveItems: %w", err)
	}
	if survey.RunState(state) != survey.RunOpen {
		return fmt.Errorf("surveystore.ResolveItems: run %d: %w", runID, survey.ErrRunNotOpen)
	}

	for _, d := range decisions {
		var questionID int64
		var resolution sql.NullString
		err := tx.QueryRowContext(ctx,
			`SELECT question_id, resolution FROM survey_review_item WHERE id = ? AND copy_id = ?`, d.ItemID, copyID,
		).Scan(&questionID, &resolution)
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("surveystore.ResolveItems: item %d: %w", d.ItemID, survey.ErrItemNotFound)
		}
		if err != nil {
			return fmt.Errorf("surveystore.ResolveItems: item %d: %w", d.ItemID, err)
		}
		if resolution.Valid {
			return fmt.Errorf("surveystore.ResolveItems: item %d: %w", d.ItemID, survey.ErrItemResolved)
		}
		if _, err := tx.ExecContext(ctx, `
            UPDATE survey_review_item SET resolution = ?, comment = ?, resolved_at = ?, resolved_by = ?
            WHERE id = ?`, string(d.Resolution), d.Comment, now.Unix(), by, d.ItemID); err != nil {
			return fmt.Errorf("surveystore.ResolveItems: item %d: %w", d.ItemID, err)
		}
		if d.Resolution != survey.ResolutionChosen {
			continue
		}
		for _, alt := range d.AlternativeIDs {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO survey_mark (copy_id, question_id, alternative_id) VALUES (?, ?, ?)`,
				copyID, questionID, alt); err != nil {
				return fmt.Errorf("surveystore.ResolveItems: item %d's mark: %w", d.ItemID, err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("surveystore.ResolveItems: commit: %w", err)
	}
	return nil
}

// DeleteReadings removes an open run's copies; marks and items cascade.
func (s *Store) DeleteReadings(ctx context.Context, runID int64) error {
	result, err := s.db.ExecContext(ctx, `
        DELETE FROM survey_copy
        WHERE run_id = ? AND (SELECT state FROM survey_run WHERE id = ?) = 'open'`, runID, runID)
	if err != nil {
		return fmt.Errorf("surveystore.DeleteReadings for run %d: %w", runID, err)
	}
	if n, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("surveystore.DeleteReadings for run %d: %w", runID, err)
	} else if n > 0 {
		return nil
	}
	// Nothing deleted: a run with no copies is fine, a run not open is not.
	var state string
	if err := s.db.QueryRowContext(ctx, `SELECT state FROM survey_run WHERE id = ?`, runID).Scan(&state); err != nil {
		return fmt.Errorf("surveystore.DeleteReadings for run %d: %w", runID, err)
	}
	if survey.RunState(state) != survey.RunOpen {
		return fmt.Errorf("surveystore.DeleteReadings for run %d: %w", runID, survey.ErrRunNotOpen)
	}
	return nil
}

// DecidedItems counts the run's resolved review items.
func (s *Store) DecidedItems(ctx context.Context, runID int64) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `
        SELECT count(*) FROM survey_review_item i JOIN survey_copy c ON c.id = i.copy_id
        WHERE c.run_id = ? AND i.resolution IS NOT NULL`, runID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("surveystore.DecidedItems for run %d: %w", runID, err)
	}
	return n, nil
}
