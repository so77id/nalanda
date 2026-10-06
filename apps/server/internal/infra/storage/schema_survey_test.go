package storage_test

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

// Issue #309 (WP-1 of epic #308): the survey bank's schema. Asserted rather
// than trusted to review for the reason schema_test.go's header gives — a
// CHECK or a cascade that is missing fails silently. Every refusal case
// names the constraint that refused it and varies nothing else
// (backend-code-style.md §Adding a migration, rule 9).

func insertSurveyRow(t *testing.T, ctx context.Context, db *sql.DB, courseID, userID int64) int64 {
	t.Helper()

	result, err := db.ExecContext(ctx,
		`INSERT INTO survey (course_id, name, created_by) VALUES (?, 'Autoevaluación', ?)`,
		courseID, userID)
	if err != nil {
		t.Fatalf("inserting the survey: %v", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("reading the survey id: %v", err)
	}
	return id
}

func insertQuestionRow(t *testing.T, ctx context.Context, db *sql.DB, surveyID int64, position int, kind string) int64 {
	t.Helper()

	result, err := db.ExecContext(ctx,
		`INSERT INTO survey_question (survey_id, position, kind, statement) VALUES (?, ?, ?, '¿?')`,
		surveyID, position, kind)
	if err != nil {
		t.Fatalf("inserting the question: %v", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("reading the question id: %v", err)
	}
	return id
}

func TestTheSurveySchemaAcceptsABankOfEveryKind(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "profesora@example.com")
	courseID := insertCourse(t, ctx, db, "CIT2006-03", "canvas-course-1")
	surveyID := insertSurveyRow(t, ctx, db, courseID, userID)

	single := insertQuestionRow(t, ctx, db, surveyID, 1, "single")
	insertQuestionRow(t, ctx, db, surveyID, 2, "scale")
	if _, err := db.ExecContext(ctx, `
        INSERT INTO survey_question (survey_id, position, kind, statement, min_marks, max_marks)
        VALUES (?, 3, 'multi', '¿Cuáles?', 0, 3)`, surveyID); err != nil {
		t.Fatalf("a multi-select with marks: %v", err)
	}
	if _, err := db.ExecContext(ctx,
		`UPDATE survey_question SET is_context = 1 WHERE id = ?`, single); err != nil {
		t.Fatalf("a single-choice context question: %v", err)
	}
	// A scale point may print with its number only.
	if _, err := db.ExecContext(ctx,
		`INSERT INTO survey_alternative (question_id, position, label) VALUES (?, 1, '')`, single); err != nil {
		t.Fatalf("an empty label: %v", err)
	}

	var archived sql.NullInt64
	var createdAt int64
	if err := db.QueryRowContext(ctx,
		`SELECT archived_at, created_at FROM survey WHERE id = ?`, surveyID).Scan(&archived, &createdAt); err != nil {
		t.Fatalf("reading the survey: %v", err)
	}
	if archived.Valid || createdAt == 0 {
		t.Errorf("a new survey: archived_at = %v, created_at = %d; want NULL and a timestamp", archived, createdAt)
	}
}

func TestTheSurveyQuestionRefusesWhatTheDomainRefuses(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "profesora@example.com")
	courseID := insertCourse(t, ctx, db, "CIT2006-03", "canvas-course-1")
	surveyID := insertSurveyRow(t, ctx, db, courseID, userID)

	// Every case uses its own position, so the UNIQUE (survey_id, position)
	// can never be the constraint that fired.
	cases := []struct {
		name string
		sql  string
		args []any
		want string
	}{
		{"an unknown kind",
			`INSERT INTO survey_question (survey_id, position, kind, statement) VALUES (?, 10, 'ranking', '¿?')`,
			[]any{surveyID}, "CHECK"},
		{"a blank statement",
			`INSERT INTO survey_question (survey_id, position, kind, statement) VALUES (?, 11, 'single', '   ')`,
			[]any{surveyID}, "CHECK"},
		{"position zero",
			`INSERT INTO survey_question (survey_id, position, kind, statement) VALUES (?, 0, 'single', '¿?')`,
			[]any{surveyID}, "CHECK"},
		{"a context scale",
			`INSERT INTO survey_question (survey_id, position, kind, statement, is_context) VALUES (?, 12, 'scale', '¿?', 1)`,
			[]any{surveyID}, "CHECK"},
		{"marks on a single-choice question",
			`INSERT INTO survey_question (survey_id, position, kind, statement, min_marks) VALUES (?, 13, 'single', '¿?', 1)`,
			[]any{surveyID}, "CHECK"},
		{"a zero maximum",
			`INSERT INTO survey_question (survey_id, position, kind, statement, max_marks) VALUES (?, 14, 'multi', '¿?', 0)`,
			[]any{surveyID}, "CHECK"},
		{"a survey that does not exist",
			`INSERT INTO survey_question (survey_id, position, kind, statement) VALUES (?, 15, 'single', '¿?')`,
			[]any{surveyID + 999}, "FOREIGN KEY"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := db.ExecContext(ctx, tc.sql, tc.args...)
			if err == nil {
				t.Fatal("accepted, want a refusal")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("refused with %v, want a %s failure", err, tc.want)
			}
		})
	}

	// And the UNIQUE itself, in its own case.
	insertQuestionRow(t, ctx, db, surveyID, 1, "single")
	_, err := db.ExecContext(ctx,
		`INSERT INTO survey_question (survey_id, position, kind, statement) VALUES (?, 1, 'scale', '¿otra?')`, surveyID)
	if err == nil || !strings.Contains(err.Error(), "UNIQUE") {
		t.Errorf("two questions at one position: %v, want a UNIQUE failure", err)
	}
}

func TestASurveyNeedsAnExistingCourseAndABlankNameIsRefused(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "profesora@example.com")
	courseID := insertCourse(t, ctx, db, "CIT2006-03", "canvas-course-1")

	_, err := db.ExecContext(ctx,
		`INSERT INTO survey (course_id, name, created_by) VALUES (?, 'X', ?)`, courseID+999, userID)
	if err == nil || !strings.Contains(err.Error(), "FOREIGN KEY") {
		t.Errorf("an unknown course: %v, want a FOREIGN KEY failure", err)
	}
	_, err = db.ExecContext(ctx,
		`INSERT INTO survey (course_id, name, created_by) VALUES (?, '  ', ?)`, courseID, userID)
	if err == nil || !strings.Contains(err.Error(), "CHECK") {
		t.Errorf("a blank name: %v, want a CHECK failure", err)
	}
}

func TestDeletingASurveyRemovesItsBankAndACourseWithSurveysStays(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "profesora@example.com")
	courseID := insertCourse(t, ctx, db, "CIT2006-03", "canvas-course-1")
	surveyID := insertSurveyRow(t, ctx, db, courseID, userID)
	questionID := insertQuestionRow(t, ctx, db, surveyID, 1, "single")
	if _, err := db.ExecContext(ctx,
		`INSERT INTO survey_alternative (question_id, position, label) VALUES (?, 1, 'A'), (?, 2, 'B')`,
		questionID, questionID); err != nil {
		t.Fatalf("inserting the alternatives: %v", err)
	}

	_, err := db.ExecContext(ctx, `DELETE FROM course WHERE id = ?`, courseID)
	if err == nil || !strings.Contains(err.Error(), "FOREIGN KEY") {
		t.Fatalf("deleting a course with a survey: %v, want a FOREIGN KEY failure", err)
	}

	if _, err := db.ExecContext(ctx, `DELETE FROM survey WHERE id = ?`, surveyID); err != nil {
		t.Fatalf("deleting the survey: %v", err)
	}
	for _, table := range []string{"survey_question", "survey_alternative"} {
		var n int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM `+table).Scan(&n); err != nil {
			t.Fatalf("counting %s: %v", table, err)
		}
		if n != 0 {
			t.Errorf("%s kept %d rows after its survey was deleted, want the cascade", table, n)
		}
	}
}

// Issue #310 S2: the run tables refuse what the domain refuses, and a
// question a run printed cannot be deleted from under it.
func TestTheRunSchemaRefusesWhatTheDomainRefuses(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "profesora@example.com")
	courseID := insertCourse(t, ctx, db, "CIT2006-03", "canvas-course-1")
	surveyID := insertSurveyRow(t, ctx, db, courseID, userID)
	questionID := insertQuestionRow(t, ctx, db, surveyID, 1, "single")

	insert := `INSERT INTO survey_run (survey_id, number, applied_on, copies, state, created_by) VALUES (?, ?, ?, ?, ?, ?)`
	if _, err := db.ExecContext(ctx, insert, surveyID, 1, "2026-10-15", 30, "open", userID); err != nil {
		t.Fatalf("a valid run: %v", err)
	}
	// Each case its own number, so the UNIQUE is never the one that fired.
	cases := []struct {
		name string
		args []any
	}{
		{"an unknown state", []any{surveyID, 2, "2026-10-15", 30, "reading", userID}},
		{"a date that is not YYYY-MM-DD", []any{surveyID, 3, "15/10/2026", 30, "open", userID}},
		{"zero copies", []any{surveyID, 4, "2026-10-15", 0, "open", userID}},
		{"too many copies", []any{surveyID, 5, "2026-10-15", 201, "open", userID}},
	}
	for _, tc := range cases {
		_, err := db.ExecContext(ctx, insert, tc.args...)
		if err == nil || !strings.Contains(err.Error(), "CHECK") {
			t.Errorf("%s: %v, want a CHECK failure", tc.name, err)
		}
	}
	if _, err := db.ExecContext(ctx, insert, surveyID, 1, "2026-10-16", 30, "open", userID); err == nil ||
		!strings.Contains(err.Error(), "UNIQUE") {
		t.Errorf("a second run number 1: %v, want a UNIQUE failure", err)
	}

	var runID int64
	if err := db.QueryRowContext(ctx, `SELECT id FROM survey_run WHERE number = 1`).Scan(&runID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx,
		`INSERT INTO survey_run_question (run_id, question_id, printed_number) VALUES (?, ?, 1)`, runID, questionID); err != nil {
		t.Fatalf("snapshotting: %v", err)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM survey_question WHERE id = ?`, questionID); err == nil ||
		!strings.Contains(err.Error(), "FOREIGN KEY") {
		t.Errorf("deleting a printed question: %v, want a FOREIGN KEY failure", err)
	}
}
