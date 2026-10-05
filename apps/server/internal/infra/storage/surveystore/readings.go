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
		// DO NOTHING on a copy that is already there: it was not
		// re-captured, so it is the reading the professor already worked
		// on.
		result, err := tx.ExecContext(ctx, `
            INSERT INTO survey_copy (run_id, copy_number, pages_json) VALUES (?, ?, ?)
            ON CONFLICT (run_id, copy_number) DO NOTHING`, runID, c.CopyNumber, string(pages))
		if err != nil {
			return fmt.Errorf("surveystore.SaveReadings: copy %d: %w", c.CopyNumber, err)
		}
		if n, err := result.RowsAffected(); err != nil {
			return fmt.Errorf("surveystore.SaveReadings: copy %d: %w", c.CopyNumber, err)
		} else if n == 0 {
			continue
		}
		copyID, err := result.LastInsertId()
		if err != nil {
			return fmt.Errorf("surveystore.SaveReadings: copy %d's id: %w", c.CopyNumber, err)
		}
		for _, m := range c.Marks {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO survey_mark (copy_id, question_id, alternative_id) VALUES (?, ?, ?)`,
				copyID, m.QuestionID, m.AlternativeID); err != nil {
				return fmt.Errorf("surveystore.SaveReadings: copy %d, question %d: %w", c.CopyNumber, m.QuestionID, err)
			}
		}
		for _, it := range c.Items {
			seen, err := json.Marshal(detected{Marked: nonNil(it.Marked), Doubtful: nonNil(it.Doubtful)})
			if err != nil {
				return fmt.Errorf("surveystore.SaveReadings: copy %d's item: %w", c.CopyNumber, err)
			}
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO survey_review_item (copy_id, question_id, reason, detected) VALUES (?, ?, ?, ?)`,
				copyID, it.QuestionID, string(it.Reason), string(seen)); err != nil {
				return fmt.Errorf("surveystore.SaveReadings: copy %d, item on question %d: %w", c.CopyNumber, it.QuestionID, err)
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
