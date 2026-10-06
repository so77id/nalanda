package surveystore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// The runs of a survey (issue #310, migration 00024): one row per
// application, and the snapshot of what it printed.

const runColumns = `id, survey_id, number, name, applied_on, copies, state, created_by, created_at, updated_at, closed_at`

// CreateRun numbers the run max+1 within its survey and writes its
// snapshot, in one transaction. The survey is stamped first, which takes
// the write lock before the max is read — two runs created at once cannot
// both read the same max (the UNIQUE (survey_id, number) is the belt).
func (s *Store) CreateRun(ctx context.Context, r survey.Run) (survey.Run, []survey.Question, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return survey.Run{}, nil, fmt.Errorf("surveystore.CreateRun: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := touch(ctx, tx, r.SurveyID, r.CreatedAt); err != nil {
		return survey.Run{}, nil, fmt.Errorf("surveystore.CreateRun: %w", err)
	}
	// The bank, read under the write lock: nothing can change it between
	// this read and the snapshot below.
	bank, err := questions(ctx, tx, r.SurveyID)
	if err != nil {
		return survey.Run{}, nil, fmt.Errorf("surveystore.CreateRun: %w", err)
	}
	if len(bank) == 0 {
		return survey.Run{}, nil, fmt.Errorf("surveystore.CreateRun for survey %d: %w", r.SurveyID, survey.ErrEmptyBank)
	}
	printed := survey.PrintOrder(bank)
	var number int
	if err := tx.QueryRowContext(ctx,
		`SELECT coalesce(max(number), 0) + 1 FROM survey_run WHERE survey_id = ?`, r.SurveyID,
	).Scan(&number); err != nil {
		return survey.Run{}, nil, fmt.Errorf("surveystore.CreateRun for survey %d: %w", r.SurveyID, err)
	}
	result, err := tx.ExecContext(ctx, `
        INSERT INTO survey_run (survey_id, number, name, applied_on, copies, state, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.SurveyID, number, r.Name, r.AppliedOn, r.Copies, string(survey.RunOpen),
		r.CreatedBy, r.CreatedAt.Unix(), r.CreatedAt.Unix())
	if err != nil {
		return survey.Run{}, nil, fmt.Errorf("surveystore.CreateRun for survey %d: %w", r.SurveyID, err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return survey.Run{}, nil, fmt.Errorf("surveystore.CreateRun: reading the id: %w", err)
	}
	for _, q := range printed {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO survey_run_question (run_id, question_id, printed_number) VALUES (?, ?, ?)`,
			id, q.QuestionID, q.PrintedNumber); err != nil {
			return survey.Run{}, nil, fmt.Errorf("surveystore.CreateRun: snapshotting question %d: %w", q.QuestionID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return survey.Run{}, nil, fmt.Errorf("surveystore.CreateRun: commit: %w", err)
	}
	run, err := s.Run(ctx, r.SurveyID, id)
	if err != nil {
		return survey.Run{}, nil, err
	}
	return run, bank, nil
}

// Run returns one run, scoped to its survey.
func (s *Store) Run(ctx context.Context, surveyID, runID int64) (survey.Run, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+runColumns+` FROM survey_run WHERE id = ? AND survey_id = ?`, runID, surveyID)
	r, err := scanRun(row)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return survey.Run{}, fmt.Errorf("surveystore.Run %d of survey %d: %w", runID, surveyID, survey.ErrRunNotFound)
	case err != nil:
		return survey.Run{}, fmt.Errorf("surveystore.Run %d of survey %d: %w", runID, surveyID, err)
	}
	return r, nil
}

// RunsForSurvey returns the runs, most recent number first.
func (s *Store) RunsForSurvey(ctx context.Context, surveyID int64) ([]survey.Run, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+runColumns+` FROM survey_run WHERE survey_id = ? ORDER BY number DESC`, surveyID)
	if err != nil {
		return nil, fmt.Errorf("surveystore.RunsForSurvey %d: %w", surveyID, err)
	}
	defer func() { _ = rows.Close() }()
	var out []survey.Run
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, fmt.Errorf("surveystore.RunsForSurvey %d: %w", surveyID, err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("surveystore.RunsForSurvey %d: %w", surveyID, err)
	}
	return out, nil
}

// RunQuestions returns a run's snapshot in printed order.
func (s *Store) RunQuestions(ctx context.Context, runID int64) ([]survey.RunQuestion, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT question_id, printed_number FROM survey_run_question WHERE run_id = ? ORDER BY printed_number`, runID)
	if err != nil {
		return nil, fmt.Errorf("surveystore.RunQuestions %d: %w", runID, err)
	}
	defer func() { _ = rows.Close() }()
	var out []survey.RunQuestion
	for rows.Next() {
		var q survey.RunQuestion
		if err := rows.Scan(&q.QuestionID, &q.PrintedNumber); err != nil {
			return nil, fmt.Errorf("surveystore.RunQuestions %d: %w", runID, err)
		}
		out = append(out, q)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("surveystore.RunQuestions %d: %w", runID, err)
	}
	return out, nil
}

// UpdateRun rewrites name and date.
func (s *Store) UpdateRun(ctx context.Context, surveyID, runID int64, d survey.RunDraft, now time.Time) error {
	result, err := s.db.ExecContext(ctx,
		`UPDATE survey_run SET name = ?, applied_on = ?, updated_at = ?
         WHERE id = ? AND survey_id = ? AND state = 'open'`,
		d.Name, d.AppliedOn, now.Unix(), runID, surveyID)
	if err != nil {
		return fmt.Errorf("surveystore.UpdateRun %d: %w", runID, err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("surveystore.UpdateRun %d: %w", runID, err)
	}
	if n == 1 {
		return nil
	}
	if _, err := s.Run(ctx, surveyID, runID); err != nil {
		return fmt.Errorf("surveystore.UpdateRun: %w", err)
	}
	return fmt.Errorf("surveystore.UpdateRun %d: %w", runID, survey.ErrRunNotOpen)
}

// CancelRun moves an open run to cancelled. The `state = 'open'` guard is
// in the UPDATE itself, so a run closed or cancelled meanwhile is refused
// rather than overwritten.
func (s *Store) CancelRun(ctx context.Context, surveyID, runID int64, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("surveystore.CancelRun: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.ExecContext(ctx, `
        UPDATE survey_run SET state = 'cancelled', updated_at = ?
        WHERE id = ? AND survey_id = ? AND state = 'open'`,
		now.Unix(), runID, surveyID)
	if err != nil {
		return fmt.Errorf("surveystore.CancelRun %d: %w", runID, err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("surveystore.CancelRun %d: %w", runID, err)
	}
	if n == 1 {
		// The snapshot goes with the cancel: its foreign key on the
		// question (no ON DELETE) would otherwise keep every printed
		// question undeletable while the run that printed them counts
		// for nothing (#310 review, COR-1).
		if _, err := tx.ExecContext(ctx, `DELETE FROM survey_run_question WHERE run_id = ?`, runID); err != nil {
			return fmt.Errorf("surveystore.CancelRun %d: dropping the snapshot: %w", runID, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("surveystore.CancelRun %d: commit: %w", runID, err)
		}
		return nil
	}
	_ = tx.Rollback()
	// Nothing changed: tell absence from a run in the wrong state.
	if _, err := s.Run(ctx, surveyID, runID); err != nil {
		return fmt.Errorf("surveystore.CancelRun: %w", err)
	}
	return fmt.Errorf("surveystore.CancelRun %d: %w", runID, survey.ErrRunNotCancellable)
}

// RunSummaries is one GROUP BY for a course's survey list.
func (s *Store) RunSummaries(ctx context.Context, courseID int64) (map[int64]survey.RunSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT r.survey_id, count(*), max(r.applied_on)
        FROM survey_run r JOIN survey s ON s.id = r.survey_id
        WHERE s.course_id = ? AND r.state <> 'cancelled'
        GROUP BY r.survey_id`, courseID)
	if err != nil {
		return nil, fmt.Errorf("surveystore.RunSummaries %d: %w", courseID, err)
	}
	defer func() { _ = rows.Close() }()
	out := map[int64]survey.RunSummary{}
	for rows.Next() {
		var id int64
		var sum survey.RunSummary
		if err := rows.Scan(&id, &sum.Runs, &sum.LastAppliedOn); err != nil {
			return nil, fmt.Errorf("surveystore.RunSummaries %d: %w", courseID, err)
		}
		out[id] = sum
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("surveystore.RunSummaries %d: %w", courseID, err)
	}
	return out, nil
}

// requireUnlocked refuses a bank write while a run that is not cancelled
// exists. It runs inside the write's transaction after touch() took the
// write lock, so no run can be created between this check and the write.
func requireUnlocked(ctx context.Context, tx *sql.Tx, surveyID int64) error {
	var locked bool
	if err := tx.QueryRowContext(ctx,
		`SELECT EXISTS (SELECT 1 FROM survey_run WHERE survey_id = ? AND state <> 'cancelled')`, surveyID,
	).Scan(&locked); err != nil {
		return fmt.Errorf("checking the bank lock of survey %d: %w", surveyID, err)
	}
	if locked {
		return fmt.Errorf("survey %d: %w", surveyID, survey.ErrBankLocked)
	}
	return nil
}

func scanRun(row scanner) (survey.Run, error) {
	var (
		r         survey.Run
		state     string
		createdAt int64
		updatedAt int64
		closedAt  sql.NullInt64
	)
	if err := row.Scan(&r.ID, &r.SurveyID, &r.Number, &r.Name, &r.AppliedOn, &r.Copies, &state,
		&r.CreatedBy, &createdAt, &updatedAt, &closedAt); err != nil {
		return survey.Run{}, err
	}
	r.State = survey.RunState(state)
	r.CreatedAt = time.Unix(createdAt, 0).UTC()
	r.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	if closedAt.Valid {
		at := time.Unix(closedAt.Int64, 0).UTC()
		r.ClosedAt = &at
	}
	return r, nil
}
