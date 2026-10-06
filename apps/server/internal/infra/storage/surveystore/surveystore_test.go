package surveystore_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/surveystore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// The store against a real temp SQLite file with the migrations the binary
// ships (testing-strategy.md L6): positions, cascades and the course check
// are properties of the schema and the SQL together, which a fake would
// only restate.

type fixture struct {
	ctx      context.Context
	db       *sql.DB
	store    *surveystore.Store
	userID   int64
	courseID int64
	now      time.Time
}

func newFixture(t *testing.T) *fixture {
	t.Helper()

	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := storage.Migrate(ctx, db, migrations.FS); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	f := &fixture{
		ctx:   ctx,
		db:    db,
		store: surveystore.New(db),
		now:   time.Date(2026, time.October, 5, 12, 0, 0, 0, time.UTC),
	}
	f.userID = f.exec(t, `INSERT INTO users (email, name) VALUES ('profesora@example.com', 'Profesora')`)
	f.courseID = f.exec(t, `INSERT INTO course (name, code, term, canvas_course_id) VALUES ('ED', 'CIT2006-03', '2026-2', 'c1')`)
	return f
}

func (f *fixture) exec(t *testing.T, query string, args ...any) int64 {
	t.Helper()
	result, err := f.db.ExecContext(f.ctx, query, args...)
	if err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("LastInsertId: %v", err)
	}
	return id
}

func (f *fixture) createSurvey(t *testing.T, name string) survey.Survey {
	t.Helper()
	s, err := f.store.CreateSurvey(f.ctx, survey.Survey{
		CourseID: f.courseID, Name: name, Description: "Es anónima.",
		CreatedBy: f.userID, CreatedAt: f.now, UpdatedAt: f.now,
	})
	if err != nil {
		t.Fatalf("CreateSurvey: %v", err)
	}
	return s
}

func single(statement string, labels ...string) survey.QuestionDraft {
	return survey.QuestionDraft{Kind: survey.KindSingle, Statement: statement, Labels: labels}
}

func (f *fixture) add(t *testing.T, surveyID int64, d survey.QuestionDraft) survey.Question {
	t.Helper()
	q, err := f.store.AddQuestion(f.ctx, surveyID, d, f.now)
	if err != nil {
		t.Fatalf("AddQuestion: %v", err)
	}
	return q
}

func statements(t *testing.T, f *fixture, surveyID int64) string {
	t.Helper()
	qs, err := f.store.Questions(f.ctx, surveyID)
	if err != nil {
		t.Fatalf("Questions: %v", err)
	}
	out := make([]string, len(qs))
	for i, q := range qs {
		if q.Position != i+1 {
			t.Errorf("question %q at position %d, want %d (dense, 1-based)", q.Statement, q.Position, i+1)
		}
		out[i] = q.Statement
	}
	return strings.Join(out, ",")
}

func TestASurveyRoundTrips(t *testing.T) {
	f := newFixture(t)
	created := f.createSurvey(t, "Autoevaluación")
	if created.ID == 0 {
		t.Fatal("CreateSurvey returned no id")
	}

	got, err := f.store.SurveyByID(f.ctx, created.ID)
	if err != nil {
		t.Fatalf("SurveyByID: %v", err)
	}
	if got.Name != "Autoevaluación" || got.Description != "Es anónima." || got.CourseID != f.courseID ||
		got.CreatedBy != f.userID || !got.CreatedAt.Equal(f.now) || got.Archived() {
		t.Errorf("round trip: %+v", got)
	}

	_, err = f.store.SurveyByID(f.ctx, created.ID+99)
	if !errors.Is(err, survey.ErrSurveyNotFound) {
		t.Errorf("an unknown id: %v, want ErrSurveyNotFound", err)
	}
}

func TestCreatingASurveyUnderAnUnknownCourseIsCourseNotFound(t *testing.T) {
	f := newFixture(t)
	_, err := f.store.CreateSurvey(f.ctx, survey.Survey{
		CourseID: f.courseID + 99, Name: "X", CreatedBy: f.userID, CreatedAt: f.now, UpdatedAt: f.now,
	})
	if !errors.Is(err, survey.ErrCourseNotFound) {
		t.Errorf("err = %v, want ErrCourseNotFound", err)
	}
}

func TestSurveysForCourseAreNewestFirstAndOnlyThatCourses(t *testing.T) {
	f := newFixture(t)
	first := f.createSurvey(t, "Primera")
	f.now = f.now.Add(time.Hour)
	second := f.createSurvey(t, "Segunda")
	other := f.exec(t, `INSERT INTO course (name, code, term, canvas_course_id) VALUES ('ED', 'CIT2006-04', '2026-2', 'c2')`)
	if _, err := f.store.CreateSurvey(f.ctx, survey.Survey{
		CourseID: other, Name: "Ajena", CreatedBy: f.userID, CreatedAt: f.now, UpdatedAt: f.now,
	}); err != nil {
		t.Fatalf("CreateSurvey: %v", err)
	}

	got, err := f.store.SurveysForCourse(f.ctx, f.courseID)
	if err != nil {
		t.Fatalf("SurveysForCourse: %v", err)
	}
	if len(got) != 2 || got[0].ID != second.ID || got[1].ID != first.ID {
		t.Errorf("got %+v, want [Segunda, Primera]", got)
	}
}

func TestQuestionCountsSkipAnEmptyBank(t *testing.T) {
	f := newFixture(t)
	full := f.createSurvey(t, "Con preguntas")
	empty := f.createSurvey(t, "Vacía")
	f.add(t, full.ID, single("¿1?", "A", "B"))
	f.add(t, full.ID, single("¿2?", "A", "B"))

	counts, err := f.store.QuestionCounts(f.ctx, f.courseID)
	if err != nil {
		t.Fatalf("QuestionCounts: %v", err)
	}
	if counts[full.ID] != 2 {
		t.Errorf("full: %d, want 2", counts[full.ID])
	}
	if _, ok := counts[empty.ID]; ok {
		t.Error("an empty bank has an entry, want none")
	}
}

func TestUpdateAndArchiveASurvey(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Antes")
	later := f.now.Add(time.Hour)

	if err := f.store.UpdateSurvey(f.ctx, s.ID, survey.SurveyDraft{Name: "Después", Description: ""}, later); err != nil {
		t.Fatalf("UpdateSurvey: %v", err)
	}
	if err := f.store.SetArchived(f.ctx, s.ID, &later, later); err != nil {
		t.Fatalf("SetArchived: %v", err)
	}
	got, _ := f.store.SurveyByID(f.ctx, s.ID)
	if got.Name != "Después" || got.Description != "" || !got.UpdatedAt.Equal(later) ||
		got.ArchivedAt == nil || !got.ArchivedAt.Equal(later) {
		t.Errorf("after update + archive: %+v", got)
	}

	if err := f.store.SetArchived(f.ctx, s.ID, nil, later); err != nil {
		t.Fatalf("SetArchived(nil): %v", err)
	}
	if got, _ := f.store.SurveyByID(f.ctx, s.ID); got.Archived() {
		t.Error("restore left the survey archived")
	}

	for name, err := range map[string]error{
		"update":  f.store.UpdateSurvey(f.ctx, s.ID+99, survey.SurveyDraft{Name: "X"}, later),
		"archive": f.store.SetArchived(f.ctx, s.ID+99, &later, later),
	} {
		if !errors.Is(err, survey.ErrSurveyNotFound) {
			t.Errorf("%s an unknown survey: %v, want ErrSurveyNotFound", name, err)
		}
	}
}

func TestAQuestionRoundTripsWithItsAlternativesAndMarks(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	lo, hi := 1, 3
	added := f.add(t, s.ID, survey.QuestionDraft{
		Kind: survey.KindMulti, Statement: "¿Cuáles?", Section: "Confianza",
		Labels: []string{"Heap", "BST", "Stack"}, MinMarks: &lo, MaxMarks: &hi,
	})
	f.add(t, s.ID, survey.QuestionDraft{Kind: survey.KindScale, Statement: "¿Clara?", Labels: []string{"Nada", "", "Muy"}})

	qs, err := f.store.Questions(f.ctx, s.ID)
	if err != nil {
		t.Fatalf("Questions: %v", err)
	}
	if len(qs) != 2 {
		t.Fatalf("got %d questions, want 2", len(qs))
	}
	q := qs[0]
	if q.ID != added.ID || q.SurveyID != s.ID || q.Position != 1 || q.Kind != survey.KindMulti ||
		q.Section != "Confianza" || q.MinMarks == nil || *q.MinMarks != 1 || q.MaxMarks == nil || *q.MaxMarks != 3 {
		t.Errorf("multi: %+v", q)
	}
	var labels []string
	for i, a := range q.Alternatives {
		if a.Position != i+1 || a.ID == 0 {
			t.Errorf("alternative %d: %+v", i, a)
		}
		labels = append(labels, a.Label)
	}
	if strings.Join(labels, ",") != "Heap,BST,Stack" {
		t.Errorf("labels = %v", labels)
	}
	if scale := qs[1]; scale.MinMarks != nil || scale.MaxMarks != nil || len(scale.Alternatives) != 3 ||
		scale.Alternatives[1].Label != "" {
		t.Errorf("scale: %+v", scale)
	}
}

func TestQuestionsOfAnUnknownSurveyIsSurveyNotFound(t *testing.T) {
	f := newFixture(t)
	if _, err := f.store.Questions(f.ctx, 999); !errors.Is(err, survey.ErrSurveyNotFound) {
		t.Errorf("err = %v, want ErrSurveyNotFound", err)
	}
	if _, err := f.store.AddQuestion(f.ctx, 999, single("¿?", "A", "B"), f.now); !errors.Is(err, survey.ErrSurveyNotFound) {
		t.Errorf("AddQuestion: err = %v, want ErrSurveyNotFound", err)
	}
}

func TestUpdatingAQuestionReplacesItsAlternativesAndKeepsItsPlace(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	f.add(t, s.ID, single("¿1?", "A", "B"))
	q := f.add(t, s.ID, single("¿2?", "A", "B", "C"))
	f.add(t, s.ID, single("¿3?", "A", "B"))

	if err := f.store.UpdateQuestion(f.ctx, s.ID, q.ID, single("¿dos?", "X", "Y"), f.now); err != nil {
		t.Fatalf("UpdateQuestion: %v", err)
	}
	if got := statements(t, f, s.ID); got != "¿1?,¿dos?,¿3?" {
		t.Errorf("bank = %s", got)
	}
	qs, _ := f.store.Questions(f.ctx, s.ID)
	if len(qs[1].Alternatives) != 2 || qs[1].Alternatives[0].Label != "X" {
		t.Errorf("alternatives = %+v, want exactly X,Y", qs[1].Alternatives)
	}
	var orphans int
	if err := f.db.QueryRowContext(f.ctx, `SELECT count(*) FROM survey_alternative WHERE question_id = ?`, q.ID).Scan(&orphans); err != nil {
		t.Fatal(err)
	}
	if orphans != 2 {
		t.Errorf("the question holds %d alternative rows, want the old three replaced by two", orphans)
	}
}

func TestDeletingAQuestionClosesTheGap(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	f.add(t, s.ID, single("¿1?", "A", "B"))
	q := f.add(t, s.ID, single("¿2?", "A", "B"))
	f.add(t, s.ID, single("¿3?", "A", "B"))
	f.add(t, s.ID, single("¿4?", "A", "B"))

	if err := f.store.DeleteQuestion(f.ctx, s.ID, q.ID, f.now); err != nil {
		t.Fatalf("DeleteQuestion: %v", err)
	}
	if got := statements(t, f, s.ID); got != "¿1?,¿3?,¿4?" {
		t.Errorf("bank = %s", got)
	}
	// And the next question goes after the last, not into the old gap.
	f.add(t, s.ID, single("¿5?", "A", "B"))
	if got := statements(t, f, s.ID); got != "¿1?,¿3?,¿4?,¿5?" {
		t.Errorf("bank after an add = %s", got)
	}
}

func TestMovingAQuestionSwapsItWithItsNeighbour(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	first := f.add(t, s.ID, single("¿1?", "A", "B"))
	second := f.add(t, s.ID, single("¿2?", "A", "B"))
	last := f.add(t, s.ID, single("¿3?", "A", "B"))

	steps := []struct {
		id    int64
		delta int
		want  string
	}{
		{second.ID, -1, "¿2?,¿1?,¿3?"},
		{second.ID, -1, "¿2?,¿1?,¿3?"}, // already first: nothing
		{first.ID, +1, "¿2?,¿3?,¿1?"},
		{first.ID, +1, "¿2?,¿3?,¿1?"}, // already last: nothing
		{last.ID, -1, "¿3?,¿2?,¿1?"},
	}
	for i, step := range steps {
		if err := f.store.MoveQuestion(f.ctx, s.ID, step.id, step.delta, f.now); err != nil {
			t.Fatalf("step %d: MoveQuestion: %v", i, err)
		}
		if got := statements(t, f, s.ID); got != step.want {
			t.Errorf("step %d: bank = %s, want %s", i, got, step.want)
		}
	}
}

func TestAQuestionOfAnotherSurveyIsNotFound(t *testing.T) {
	f := newFixture(t)
	mine := f.createSurvey(t, "Mía")
	other := f.createSurvey(t, "Otra")
	theirs := f.add(t, other.ID, single("¿ajena?", "A", "B"))

	for name, err := range map[string]error{
		"update": f.store.UpdateQuestion(f.ctx, mine.ID, theirs.ID, single("¿?", "A", "B"), f.now),
		"delete": f.store.DeleteQuestion(f.ctx, mine.ID, theirs.ID, f.now),
		"move":   f.store.MoveQuestion(f.ctx, mine.ID, theirs.ID, 1, f.now),
	} {
		if !errors.Is(err, survey.ErrQuestionNotFound) {
			t.Errorf("%s through the wrong survey: %v, want ErrQuestionNotFound", name, err)
		}
	}
	// And it is untouched.
	if got := statements(t, f, other.ID); got != "¿ajena?" {
		t.Errorf("the other survey's bank = %s", got)
	}
}

func TestEditingTheBankStampsTheSurvey(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	later := f.now.Add(2 * time.Hour)
	if _, err := f.store.AddQuestion(f.ctx, s.ID, single("¿?", "A", "B"), later); err != nil {
		t.Fatalf("AddQuestion: %v", err)
	}
	got, _ := f.store.SurveyByID(f.ctx, s.ID)
	if !got.UpdatedAt.Equal(later) {
		t.Errorf("updated_at = %v, want %v", got.UpdatedAt, later)
	}
}

// #309 review, COR-1: once a bank has been reordered, row-id order is no
// longer position order, and a set-based `UPDATE … SET position =
// position - 1` visits a row whose new position is still held by one it
// has not reached yet — the UNIQUE (survey_id, position) refuses it
// mid-statement. Only a bank in insertion order hides that, which is the
// bank TestDeletingAQuestionClosesTheGap uses.
func TestDeletingFromAReorderedBankClosesTheGap(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	first := f.add(t, s.ID, single("¿1?", "A", "B"))
	second := f.add(t, s.ID, single("¿2?", "A", "B"))
	f.add(t, s.ID, single("¿3?", "A", "B"))
	f.add(t, s.ID, single("¿4?", "A", "B"))
	for i := 0; i < 3; i++ {
		if err := f.store.MoveQuestion(f.ctx, s.ID, first.ID, +1, f.now); err != nil {
			t.Fatalf("MoveQuestion: %v", err)
		}
	}
	if got := statements(t, f, s.ID); got != "¿2?,¿3?,¿4?,¿1?" {
		t.Fatalf("bank after the moves = %s", got)
	}

	if err := f.store.DeleteQuestion(f.ctx, s.ID, second.ID, f.now); err != nil {
		t.Fatalf("DeleteQuestion: %v", err)
	}
	if got := statements(t, f, s.ID); got != "¿3?,¿4?,¿1?" {
		t.Errorf("bank = %s, want ¿3?,¿4?,¿1? dense", got)
	}
}
