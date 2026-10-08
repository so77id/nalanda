package surveystore_test

import (
	"errors"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// Runs and the bank lock (issue #310 S2), against the real schema.

// createRun creates a run of the survey's current bank, giving the bank a
// question first when it has none (a run of an empty bank is refused).
func (f *fixture) createRun(t *testing.T, s survey.Survey) survey.Run {
	t.Helper()
	if qs, _ := f.store.Questions(f.ctx, s.ID); len(qs) == 0 {
		f.add(t, s.ID, single("¿relleno?", "A", "B"))
	}
	r, _, err := f.store.CreateRun(f.ctx, survey.Run{
		SurveyID: s.ID, Name: "Mitad", AppliedOn: "2026-10-15", Copies: 30,
		CreatedBy: f.userID, CreatedAt: f.now,
	})
	if err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
	return r
}

func TestRunsAreNumberedPerSurveyAndKeepTheirSnapshot(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	other := f.createSurvey(t, "Otra")
	q1 := f.add(t, s.ID, single("¿1?", "A", "B"))
	q2 := f.add(t, s.ID, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿contexto?", IsContext: true, Labels: []string{"A", "B"}})

	first := f.createRun(t, s)
	second := f.createRun(t, s)
	elsewhere := f.createRun(t, other)
	if first.Number != 1 || second.Number != 2 || elsewhere.Number != 1 {
		t.Errorf("numbers = %d, %d, %d; want 1, 2 and 1 for the other survey", first.Number, second.Number, elsewhere.Number)
	}
	if first.State != survey.RunOpen || first.Copies != 30 || first.AppliedOn != "2026-10-15" || first.CreatedBy != f.userID {
		t.Errorf("round trip: %+v", first)
	}

	snapshot, err := f.store.RunQuestions(f.ctx, first.ID)
	if err != nil {
		t.Fatalf("RunQuestions: %v", err)
	}
	if len(snapshot) != 2 || snapshot[0].QuestionID != q2.ID || snapshot[1].QuestionID != q1.ID {
		t.Errorf("snapshot = %+v, want the context question q2 printed before q1", snapshot)
	}

	runs, err := f.store.RunsForSurvey(f.ctx, s.ID)
	if err != nil || len(runs) != 2 || runs[0].ID != second.ID {
		t.Errorf("RunsForSurvey = %+v, %v; want newest number first", runs, err)
	}
	if _, err := f.store.Run(f.ctx, s.ID, elsewhere.ID); !errors.Is(err, survey.ErrRunNotFound) {
		t.Errorf("another survey's run through this survey: %v, want ErrRunNotFound", err)
	}
}

func TestAnOpenRunLocksTheBankAndACancelledOneReleasesIt(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	q := f.add(t, s.ID, single("¿1?", "A", "B"))
	f.add(t, s.ID, single("¿2?", "A", "B"))
	run := f.createRun(t, s)

	locked := map[string]error{
		"update": f.store.UpdateQuestion(f.ctx, s.ID, q.ID, single("¿otra?", "X", "Y"), f.now),
		"delete": f.store.DeleteQuestion(f.ctx, s.ID, q.ID, f.now),
		"move":   f.store.MoveQuestion(f.ctx, s.ID, q.ID, +1, f.now),
	}
	for name, err := range locked {
		if !errors.Is(err, survey.ErrBankLocked) {
			t.Errorf("%s with an open run: %v, want ErrBankLocked", name, err)
		}
	}
	// And nothing changed under the refusal.
	if got := statements(t, f, s.ID); got != "¿1?,¿2?" {
		t.Errorf("bank = %s after refused writes", got)
	}
	// Appending stays allowed.
	if _, err := f.store.AddQuestion(f.ctx, s.ID, single("¿3?", "A", "B"), f.now); err != nil {
		t.Errorf("appending with an open run: %v, want it allowed", err)
	}

	if err := f.store.CancelRun(f.ctx, s.ID, run.ID, f.now); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}
	if err := f.store.MoveQuestion(f.ctx, s.ID, q.ID, +1, f.now); err != nil {
		t.Errorf("moving after the only run was cancelled: %v, want it allowed", err)
	}
}

func TestOnlyAnOpenRunCanBeCancelled(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	run := f.createRun(t, s)

	if err := f.store.CancelRun(f.ctx, s.ID, run.ID, f.now); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}
	if err := f.store.CancelRun(f.ctx, s.ID, run.ID, f.now); !errors.Is(err, survey.ErrRunNotCancellable) {
		t.Errorf("cancelling twice: %v, want ErrRunNotCancellable", err)
	}
	if err := f.store.CancelRun(f.ctx, s.ID, run.ID+99, f.now); !errors.Is(err, survey.ErrRunNotFound) {
		t.Errorf("cancelling nothing: %v, want ErrRunNotFound", err)
	}
	if got, _ := f.store.Run(f.ctx, s.ID, run.ID); got.State != survey.RunCancelled {
		t.Errorf("state = %s, want cancelled", got.State)
	}
}

func TestUpdateRunRewritesNameAndDate(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	run := f.createRun(t, s)
	later := f.now.Add(time.Hour)
	if err := f.store.UpdateRun(f.ctx, s.ID, run.ID, survey.RunDraft{Name: "Final", AppliedOn: "2026-12-01"}, later); err != nil {
		t.Fatalf("UpdateRun: %v", err)
	}
	got, _ := f.store.Run(f.ctx, s.ID, run.ID)
	if got.Name != "Final" || got.AppliedOn != "2026-12-01" || got.Copies != 30 || !got.UpdatedAt.Equal(later) {
		t.Errorf("after update: %+v", got)
	}
}

func TestRunSummariesCountOnlyRunsThatAreNotCancelled(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	none := f.createSurvey(t, "Sin pasadas")
	f.createRun(t, s)
	late, _, err := f.store.CreateRun(f.ctx, survey.Run{SurveyID: s.ID, AppliedOn: "2026-11-20", Copies: 5, CreatedBy: f.userID, CreatedAt: f.now})
	if err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
	cancelled, _, _ := f.store.CreateRun(f.ctx, survey.Run{SurveyID: s.ID, AppliedOn: "2026-12-31", Copies: 5, CreatedBy: f.userID, CreatedAt: f.now})
	if err := f.store.CancelRun(f.ctx, s.ID, cancelled.ID, f.now); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	sums, err := f.store.RunSummaries(f.ctx, f.courseID)
	if err != nil {
		t.Fatalf("RunSummaries: %v", err)
	}
	if got := sums[s.ID]; got.Runs != 2 || got.LastAppliedOn != late.AppliedOn {
		t.Errorf("summary = %+v, want 2 runs, last %s (the cancelled one ignored)", got, late.AppliedOn)
	}
	if _, ok := sums[none.ID]; ok {
		t.Error("a survey with no runs has an entry")
	}
}

// #310 review, COR-1: a cancelled run releases the bank for DELETE too —
// its snapshot goes with it, so the RESTRICT on the printed question no
// longer holds it.
func TestACancelledRunsPrintedQuestionsCanBeDeleted(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	q := f.add(t, s.ID, single("¿impresa?", "A", "B"))
	run := f.createRun(t, s)
	if snap, _ := f.store.RunQuestions(f.ctx, run.ID); len(snap) != 1 {
		t.Fatalf("the run printed %d questions, want the one", len(snap))
	}

	if err := f.store.CancelRun(f.ctx, s.ID, run.ID, f.now); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}
	if err := f.store.DeleteQuestion(f.ctx, s.ID, q.ID, f.now); err != nil {
		t.Errorf("deleting a question only a cancelled run printed: %v, want it allowed", err)
	}
}

// #310 review, COR-7: only an open run is edited.
func TestOnlyAnOpenRunIsEdited(t *testing.T) {
	f := newFixture(t)
	s := f.createSurvey(t, "Banco")
	run := f.createRun(t, s)
	if err := f.store.CancelRun(f.ctx, s.ID, run.ID, f.now); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}
	err := f.store.UpdateRun(f.ctx, s.ID, run.ID, survey.RunDraft{Name: "Otra", AppliedOn: "2026-12-01"}, f.now)
	if !errors.Is(err, survey.ErrRunNotOpen) {
		t.Errorf("editing a cancelled run: %v, want ErrRunNotOpen", err)
	}
	if got, _ := f.store.Run(f.ctx, s.ID, run.ID); got.Name != "Mitad" {
		t.Errorf("the cancelled run was renamed to %q", got.Name)
	}
}
