// Package surveystore is the SQLite side of the survey domain: one type
// implementing survey.Store over the tables migration 00022 creates
// (survey, survey_question, survey_alternative).
//
// It lives under internal/infra/storage beside the other stores, for the
// reason ADR-0034 gives, and it reads no table of the controls subsystem:
// the survey ↛ controls boundary (ADR-0078) is a domain rule, and this is
// where it would leak first if a query reached across.
//
// Times are unix SECONDS, because that is what the columns hold — a time
// with a fractional part comes back truncated, the contract every store
// here documents.
package surveystore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// Store is the adapter.
type Store struct {
	db *sql.DB
}

// New returns a Store over db. The caller owns the handle and its lifetime.
func New(db *sql.DB) *Store {
	return &Store{db: db}
}

var _ survey.Store = (*Store)(nil)

const surveyColumns = `id, course_id, name, description, created_by, created_at, updated_at, archived_at`

// CreateSurvey inserts one survey.
//
// The course is checked inside the transaction rather than inferred from a
// FOREIGN KEY failure: `survey` has two foreign keys (course and creator),
// and SQLite's message does not say which one fired.
func (s *Store) CreateSurvey(ctx context.Context, in survey.Survey) (survey.Survey, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return survey.Survey{}, fmt.Errorf("surveystore.CreateSurvey: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var exists int
	err = tx.QueryRowContext(ctx, `SELECT 1 FROM course WHERE id = ?`, in.CourseID).Scan(&exists)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return survey.Survey{}, fmt.Errorf("surveystore.CreateSurvey under course %d: %w", in.CourseID, survey.ErrCourseNotFound)
	case err != nil:
		return survey.Survey{}, fmt.Errorf("surveystore.CreateSurvey: reading course %d: %w", in.CourseID, err)
	}

	result, err := tx.ExecContext(ctx, `
        INSERT INTO survey (course_id, name, description, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
		in.CourseID, in.Name, in.Description, in.CreatedBy, in.CreatedAt.Unix(), in.UpdatedAt.Unix())
	if err != nil {
		return survey.Survey{}, fmt.Errorf("surveystore.CreateSurvey under course %d: %w", in.CourseID, err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return survey.Survey{}, fmt.Errorf("surveystore.CreateSurvey: reading the id: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return survey.Survey{}, fmt.Errorf("surveystore.CreateSurvey: commit: %w", err)
	}
	return s.SurveyByID(ctx, id)
}

// SurveyByID returns one survey.
func (s *Store) SurveyByID(ctx context.Context, id int64) (survey.Survey, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+surveyColumns+` FROM survey WHERE id = ?`, id)
	out, err := scanSurvey(row)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return survey.Survey{}, fmt.Errorf("surveystore.SurveyByID %d: %w", id, survey.ErrSurveyNotFound)
	case err != nil:
		return survey.Survey{}, fmt.Errorf("surveystore.SurveyByID %d: %w", id, err)
	}
	return out, nil
}

// SurveysForCourse returns every survey of one course, newest first. The id
// breaks ties between two surveys created in the same second, so the order
// is total and stable across page loads.
func (s *Store) SurveysForCourse(ctx context.Context, courseID int64) ([]survey.Survey, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT `+surveyColumns+` FROM survey
        WHERE course_id = ?
        ORDER BY created_at DESC, id DESC`, courseID)
	if err != nil {
		return nil, fmt.Errorf("surveystore.SurveysForCourse %d: %w", courseID, err)
	}
	defer func() { _ = rows.Close() }()

	var out []survey.Survey
	for rows.Next() {
		one, err := scanSurvey(rows)
		if err != nil {
			return nil, fmt.Errorf("surveystore.SurveysForCourse %d: %w", courseID, err)
		}
		out = append(out, one)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("surveystore.SurveysForCourse %d: %w", courseID, err)
	}
	return out, nil
}

// QuestionCounts is one GROUP BY for the whole course.
func (s *Store) QuestionCounts(ctx context.Context, courseID int64) (map[int64]int, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT q.survey_id, count(*)
        FROM survey_question q JOIN survey s ON s.id = q.survey_id
        WHERE s.course_id = ?
        GROUP BY q.survey_id`, courseID)
	if err != nil {
		return nil, fmt.Errorf("surveystore.QuestionCounts %d: %w", courseID, err)
	}
	defer func() { _ = rows.Close() }()

	out := map[int64]int{}
	for rows.Next() {
		var id int64
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, fmt.Errorf("surveystore.QuestionCounts %d: %w", courseID, err)
		}
		out[id] = n
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("surveystore.QuestionCounts %d: %w", courseID, err)
	}
	return out, nil
}

// UpdateSurvey rewrites name and description.
func (s *Store) UpdateSurvey(ctx context.Context, id int64, d survey.SurveyDraft, now time.Time) error {
	result, err := s.db.ExecContext(ctx,
		`UPDATE survey SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
		d.Name, d.Description, now.Unix(), id)
	if err != nil {
		return fmt.Errorf("surveystore.UpdateSurvey %d: %w", id, err)
	}
	return requireOneRow(result, fmt.Sprintf("surveystore.UpdateSurvey %d", id), survey.ErrSurveyNotFound)
}

// SetArchived stamps or clears archived_at.
func (s *Store) SetArchived(ctx context.Context, id int64, at *time.Time, now time.Time) error {
	var archivedAt any
	if at != nil {
		archivedAt = at.Unix()
	}
	result, err := s.db.ExecContext(ctx,
		`UPDATE survey SET archived_at = ?, updated_at = ? WHERE id = ?`, archivedAt, now.Unix(), id)
	if err != nil {
		return fmt.Errorf("surveystore.SetArchived %d: %w", id, err)
	}
	return requireOneRow(result, fmt.Sprintf("surveystore.SetArchived %d", id), survey.ErrSurveyNotFound)
}

// Questions reads the bank in two queries — the questions, then every
// alternative of the survey — rather than one query per question.
func (s *Store) Questions(ctx context.Context, surveyID int64) ([]survey.Question, error) {
	if _, err := s.SurveyByID(ctx, surveyID); err != nil {
		return nil, fmt.Errorf("surveystore.Questions: %w", err)
	}
	return questions(ctx, s.db, surveyID)
}

// querier is what both *sql.DB and *sql.Tx offer, so the bank reads the
// same inside and outside a transaction.
type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func questions(ctx context.Context, q querier, surveyID int64) ([]survey.Question, error) {
	rows, err := q.QueryContext(ctx, `
        SELECT id, position, kind, statement, section, is_context, min_marks, max_marks
        FROM survey_question WHERE survey_id = ?
        ORDER BY position`, surveyID)
	if err != nil {
		return nil, fmt.Errorf("surveystore: reading the bank of survey %d: %w", surveyID, err)
	}
	defer func() { _ = rows.Close() }()

	var out []survey.Question
	index := map[int64]int{}
	for rows.Next() {
		var (
			one       survey.Question
			kind      string
			isContext int
			minMarks  sql.NullInt64
			maxMarks  sql.NullInt64
		)
		if err := rows.Scan(&one.ID, &one.Position, &kind, &one.Statement, &one.Section,
			&isContext, &minMarks, &maxMarks); err != nil {
			return nil, fmt.Errorf("surveystore: reading the bank of survey %d: %w", surveyID, err)
		}
		one.SurveyID = surveyID
		one.Kind = survey.QuestionKind(kind)
		one.IsContext = isContext == 1
		one.MinMarks = intPtr(minMarks)
		one.MaxMarks = intPtr(maxMarks)
		index[one.ID] = len(out)
		out = append(out, one)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("surveystore: reading the bank of survey %d: %w", surveyID, err)
	}
	_ = rows.Close()

	alts, err := q.QueryContext(ctx, `
        SELECT a.question_id, a.id, a.position, a.label
        FROM survey_alternative a JOIN survey_question q ON q.id = a.question_id
        WHERE q.survey_id = ?
        ORDER BY a.question_id, a.position`, surveyID)
	if err != nil {
		return nil, fmt.Errorf("surveystore: reading the alternatives of survey %d: %w", surveyID, err)
	}
	defer func() { _ = alts.Close() }()
	for alts.Next() {
		var questionID int64
		var a survey.Alternative
		if err := alts.Scan(&questionID, &a.ID, &a.Position, &a.Label); err != nil {
			return nil, fmt.Errorf("surveystore: reading the alternatives of survey %d: %w", surveyID, err)
		}
		if i, ok := index[questionID]; ok {
			out[i].Alternatives = append(out[i].Alternatives, a)
		}
	}
	if err := alts.Err(); err != nil {
		return nil, fmt.Errorf("surveystore: reading the alternatives of survey %d: %w", surveyID, err)
	}
	return out, nil
}

// AddQuestion appends at max(position)+1, inside one transaction with its
// alternatives so a half-written question is never visible.
func (s *Store) AddQuestion(ctx context.Context, surveyID int64, d survey.QuestionDraft, now time.Time) (survey.Question, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return survey.Question{}, fmt.Errorf("surveystore.AddQuestion: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := touch(ctx, tx, surveyID, now); err != nil {
		return survey.Question{}, fmt.Errorf("surveystore.AddQuestion: %w", err)
	}

	var next int
	if err := tx.QueryRowContext(ctx,
		`SELECT coalesce(max(position), 0) + 1 FROM survey_question WHERE survey_id = ?`, surveyID,
	).Scan(&next); err != nil {
		return survey.Question{}, fmt.Errorf("surveystore.AddQuestion to survey %d: %w", surveyID, err)
	}

	result, err := tx.ExecContext(ctx, `
        INSERT INTO survey_question (survey_id, position, kind, statement, section, is_context, min_marks, max_marks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		surveyID, next, string(d.Kind), d.Statement, d.Section, boolInt(d.IsContext),
		nullInt(d.MinMarks), nullInt(d.MaxMarks))
	if err != nil {
		return survey.Question{}, fmt.Errorf("surveystore.AddQuestion to survey %d: %w", surveyID, err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return survey.Question{}, fmt.Errorf("surveystore.AddQuestion: reading the id: %w", err)
	}
	if err := insertAlternatives(ctx, tx, id, d.Labels); err != nil {
		return survey.Question{}, fmt.Errorf("surveystore.AddQuestion to survey %d: %w", surveyID, err)
	}
	bank, err := questions(ctx, tx, surveyID)
	if err != nil {
		return survey.Question{}, fmt.Errorf("surveystore.AddQuestion: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return survey.Question{}, fmt.Errorf("surveystore.AddQuestion: commit: %w", err)
	}
	for _, q := range bank {
		if q.ID == id {
			return q, nil
		}
	}
	return survey.Question{}, fmt.Errorf("surveystore.AddQuestion: question %d vanished inside its own transaction", id)
}

// UpdateQuestion rewrites the question's fields and replaces its
// alternatives wholesale. Replacing rather than diffing is safe in WP-1
// because nothing references an alternative yet; WP-2 locks a bank that a
// run has printed before anything does.
func (s *Store) UpdateQuestion(ctx context.Context, surveyID, questionID int64, d survey.QuestionDraft, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("surveystore.UpdateQuestion: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Stamp first, in every bank write: the UPDATE takes SQLite's write lock
	// before anything is read, so two overlapping writes on one bank (a
	// double-clicked ↑) queue on busy_timeout instead of failing the second
	// one's read-to-write upgrade with SQLITE_BUSY (#309 review, COR-2).
	if err := touch(ctx, tx, surveyID, now); err != nil {
		return fmt.Errorf("surveystore.UpdateQuestion: %w", err)
	}
	if err := requireUnlocked(ctx, tx, surveyID); err != nil {
		return fmt.Errorf("surveystore.UpdateQuestion: %w", err)
	}

	result, err := tx.ExecContext(ctx, `
        UPDATE survey_question
        SET kind = ?, statement = ?, section = ?, is_context = ?, min_marks = ?, max_marks = ?
        WHERE id = ? AND survey_id = ?`,
		string(d.Kind), d.Statement, d.Section, boolInt(d.IsContext),
		nullInt(d.MinMarks), nullInt(d.MaxMarks), questionID, surveyID)
	if err != nil {
		return fmt.Errorf("surveystore.UpdateQuestion %d of survey %d: %w", questionID, surveyID, err)
	}
	if err := requireOneRow(result, fmt.Sprintf("surveystore.UpdateQuestion %d of survey %d", questionID, surveyID), survey.ErrQuestionNotFound); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM survey_alternative WHERE question_id = ?`, questionID); err != nil {
		return fmt.Errorf("surveystore.UpdateQuestion %d: clearing alternatives: %w", questionID, err)
	}
	if err := insertAlternatives(ctx, tx, questionID, d.Labels); err != nil {
		return fmt.Errorf("surveystore.UpdateQuestion %d: %w", questionID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("surveystore.UpdateQuestion: commit: %w", err)
	}
	return nil
}

// DeleteQuestion removes the question and shifts every later one up by one.
//
// The shift runs one row at a time in ascending order: a single
// `UPDATE … SET position = position - 1` may visit a row whose new position
// is still held by a row it has not visited yet, and the UNIQUE
// (survey_id, position) is checked per row, not at the end of the
// statement.
func (s *Store) DeleteQuestion(ctx context.Context, surveyID, questionID int64, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("surveystore.DeleteQuestion: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := touch(ctx, tx, surveyID, now); err != nil {
		return fmt.Errorf("surveystore.DeleteQuestion: %w", err)
	}
	if err := requireUnlocked(ctx, tx, surveyID); err != nil {
		return fmt.Errorf("surveystore.DeleteQuestion: %w", err)
	}
	position, err := positionOf(ctx, tx, surveyID, questionID)
	if err != nil {
		return fmt.Errorf("surveystore.DeleteQuestion: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM survey_question WHERE id = ?`, questionID); err != nil {
		return fmt.Errorf("surveystore.DeleteQuestion %d: %w", questionID, err)
	}

	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM survey_question WHERE survey_id = ? AND position > ? ORDER BY position`, surveyID, position)
	if err != nil {
		return fmt.Errorf("surveystore.DeleteQuestion: reading the tail: %w", err)
	}
	var tail []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return fmt.Errorf("surveystore.DeleteQuestion: reading the tail: %w", err)
		}
		tail = append(tail, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("surveystore.DeleteQuestion: reading the tail: %w", err)
	}
	_ = rows.Close()
	for _, id := range tail {
		if _, err := tx.ExecContext(ctx,
			`UPDATE survey_question SET position = position - 1 WHERE id = ?`, id); err != nil {
			return fmt.Errorf("surveystore.DeleteQuestion: shifting question %d: %w", id, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("surveystore.DeleteQuestion: commit: %w", err)
	}
	return nil
}

// MoveQuestion swaps two adjacent positions through a parking slot above
// the bank — the UNIQUE (survey_id, position) and the CHECK (position >= 1)
// together leave no other free value to pass through.
func (s *Store) MoveQuestion(ctx context.Context, surveyID, questionID int64, delta int, now time.Time) error {
	if delta != -1 && delta != 1 {
		return fmt.Errorf("surveystore.MoveQuestion: delta %d, want -1 or +1", delta)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("surveystore.MoveQuestion: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := touch(ctx, tx, surveyID, now); err != nil {
		return fmt.Errorf("surveystore.MoveQuestion: %w", err)
	}
	if err := requireUnlocked(ctx, tx, surveyID); err != nil {
		return fmt.Errorf("surveystore.MoveQuestion: %w", err)
	}
	position, err := positionOf(ctx, tx, surveyID, questionID)
	if err != nil {
		return fmt.Errorf("surveystore.MoveQuestion: %w", err)
	}
	var neighbour int64
	err = tx.QueryRowContext(ctx,
		`SELECT id FROM survey_question WHERE survey_id = ? AND position = ?`, surveyID, position+delta,
	).Scan(&neighbour)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// Already at that edge: nothing to swap with.
		return nil
	case err != nil:
		return fmt.Errorf("surveystore.MoveQuestion: reading the neighbour: %w", err)
	}

	var parking int
	if err := tx.QueryRowContext(ctx,
		`SELECT max(position) + 1 FROM survey_question WHERE survey_id = ?`, surveyID).Scan(&parking); err != nil {
		return fmt.Errorf("surveystore.MoveQuestion: %w", err)
	}
	for _, step := range []struct {
		id       int64
		position int
	}{
		{questionID, parking},
		{neighbour, position},
		{questionID, position + delta},
	} {
		if _, err := tx.ExecContext(ctx,
			`UPDATE survey_question SET position = ? WHERE id = ?`, step.position, step.id); err != nil {
			return fmt.Errorf("surveystore.MoveQuestion: placing question %d: %w", step.id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("surveystore.MoveQuestion: commit: %w", err)
	}
	return nil
}

func positionOf(ctx context.Context, tx *sql.Tx, surveyID, questionID int64) (int, error) {
	var position int
	err := tx.QueryRowContext(ctx,
		`SELECT position FROM survey_question WHERE id = ? AND survey_id = ?`, questionID, surveyID,
	).Scan(&position)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return 0, fmt.Errorf("question %d of survey %d: %w", questionID, surveyID, survey.ErrQuestionNotFound)
	case err != nil:
		return 0, fmt.Errorf("question %d of survey %d: %w", questionID, surveyID, err)
	}
	return position, nil
}

// touch stamps the survey's updated_at, and is how a bank write learns the
// survey exists at all.
func touch(ctx context.Context, tx *sql.Tx, surveyID int64, now time.Time) error {
	result, err := tx.ExecContext(ctx, `UPDATE survey SET updated_at = ? WHERE id = ?`, now.Unix(), surveyID)
	if err != nil {
		return fmt.Errorf("stamping survey %d: %w", surveyID, err)
	}
	return requireOneRow(result, fmt.Sprintf("stamping survey %d", surveyID), survey.ErrSurveyNotFound)
}

func insertAlternatives(ctx context.Context, tx *sql.Tx, questionID int64, labels []string) error {
	for i, label := range labels {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO survey_alternative (question_id, position, label) VALUES (?, ?, ?)`,
			questionID, i+1, label); err != nil {
			return fmt.Errorf("inserting alternative %d of question %d: %w", i+1, questionID, err)
		}
	}
	return nil
}

func requireOneRow(result sql.Result, subject string, notFound error) error {
	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s: %w", subject, err)
	}
	if n == 0 {
		return fmt.Errorf("%s: %w", subject, notFound)
	}
	return nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanSurvey(row scanner) (survey.Survey, error) {
	var (
		out        survey.Survey
		createdAt  int64
		updatedAt  int64
		archivedAt sql.NullInt64
	)
	if err := row.Scan(&out.ID, &out.CourseID, &out.Name, &out.Description, &out.CreatedBy,
		&createdAt, &updatedAt, &archivedAt); err != nil {
		return survey.Survey{}, err
	}
	out.CreatedAt = time.Unix(createdAt, 0).UTC()
	out.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	if archivedAt.Valid {
		at := time.Unix(archivedAt.Int64, 0).UTC()
		out.ArchivedAt = &at
	}
	return out, nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullInt(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func intPtr(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}
