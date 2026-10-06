package surveystore_test

import (
	"reflect"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// Issue #312 S3: a run's results come from ONE aggregate query, optionally
// restricted to the copies that marked a context alternative.

// closedRun is a run of a bank with a context question (A/B) and a single
// question (X/Y), three copies read, closed:
//
//	copy 1: ctx A, single X
//	copy 2: ctx A, single Y
//	copy 3: ctx B, single blank
func (f *fixture) closedRun(t *testing.T) (survey.Run, survey.Question, survey.Question) {
	t.Helper()
	s := f.createSurvey(t, "Banco")
	ctx := f.add(t, s.ID, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿Sección?", IsContext: true, Labels: []string{"A", "B"}})
	q := f.add(t, s.ID, single("¿Ritmo?", "X", "Y"))
	run := f.createRun(t, s)
	m := func(q survey.Question, i int) survey.Mark {
		return survey.Mark{QuestionID: q.ID, AlternativeID: q.Alternatives[i].ID}
	}
	if err := f.store.SaveReadings(f.ctx, run.ID, nil, []survey.CopyReading{
		{CopyNumber: 1, Marks: []survey.Mark{m(ctx, 0), m(q, 0)}},
		{CopyNumber: 2, Marks: []survey.Mark{m(ctx, 0), m(q, 1)}},
		{CopyNumber: 3, Marks: []survey.Mark{m(ctx, 1)}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.store.CloseRun(f.ctx, run.SurveyID, run.ID, f.now); err != nil {
		t.Fatal(err)
	}
	return run, ctx, q
}

func TestRunTallyCountsAWholeRunOrAFilteredOne(t *testing.T) {
	f := newFixture(t)
	run, ctx, q := f.closedRun(t)

	all, err := f.store.RunTally(f.ctx, run.ID, nil)
	if err != nil {
		t.Fatalf("RunTally: %v", err)
	}
	want := survey.Tally{Copies: 3, ReadCopies: 3,
		Counts:   map[int64]int{ctx.Alternatives[0].ID: 2, ctx.Alternatives[1].ID: 1, q.Alternatives[0].ID: 1, q.Alternatives[1].ID: 1},
		Answered: map[int64]int{ctx.ID: 3, q.ID: 2}}
	if !reflect.DeepEqual(all, want) {
		t.Errorf("whole run = %+v, want %+v", all, want)
	}

	onlyB, err := f.store.RunTally(f.ctx, run.ID, &survey.ContextFilter{QuestionID: ctx.ID, AlternativeIDs: []int64{ctx.Alternatives[1].ID}})
	if err != nil {
		t.Fatalf("RunTally filtered: %v", err)
	}
	if onlyB.Copies != 1 || onlyB.ReadCopies != 3 || onlyB.Answered[q.ID] != 0 || onlyB.Counts[ctx.Alternatives[1].ID] != 1 {
		t.Errorf("filtered to B = %+v, want copy 3 alone, blank on the single", onlyB)
	}
	// Both alternatives: every copy that answered the context (#312 review,
	// COR-5 - the IN list with more than one id).
	both, _ := f.store.RunTally(f.ctx, run.ID, &survey.ContextFilter{QuestionID: ctx.ID, AlternativeIDs: []int64{ctx.Alternatives[0].ID, ctx.Alternatives[1].ID}})
	if both.Copies != 3 {
		t.Errorf("filtered to A or B = %+v, want all three copies", both)
	}
	none, _ := f.store.RunTally(f.ctx, run.ID, &survey.ContextFilter{QuestionID: ctx.ID})
	if none.Copies != 0 {
		t.Errorf("a filter with no alternative ticked = %+v, want the empty set", none)
	}
}

func TestClosedRunTalliesSkipOpenRunsAndCarryWhatEachPrinted(t *testing.T) {
	f := newFixture(t)
	run, ctx, q := f.closedRun(t)
	// A second, OPEN run of the same survey: it counts nowhere.
	s := survey.Survey{ID: run.SurveyID}
	open := f.createRun(t, s)
	if err := f.store.SaveReadings(f.ctx, open.ID, nil, []survey.CopyReading{{CopyNumber: 1,
		Marks: []survey.Mark{{QuestionID: q.ID, AlternativeID: q.Alternatives[0].ID}}}}); err != nil {
		t.Fatal(err)
	}

	tallies, err := f.store.ClosedRunTallies(f.ctx, run.SurveyID)
	if err != nil {
		t.Fatalf("ClosedRunTallies: %v", err)
	}
	if len(tallies) != 1 || tallies[0].Run.ID != run.ID || tallies[0].Run.State != survey.RunClosed {
		t.Fatalf("tallies = %+v, want the closed run only", tallies)
	}
	got := tallies[0]
	if got.Tally.Copies != 3 || got.Tally.Answered[q.ID] != 2 || !got.Printed[ctx.ID] || !got.Printed[q.ID] {
		t.Errorf("closed run's tally = %+v", got)
	}
}

// #312 review recheck, COR-7: two closed runs keep their counts apart.
func TestClosedRunTalliesKeepEachRunApart(t *testing.T) {
	f := newFixture(t)
	first, ctx, q := f.closedRun(t)
	second := f.createRun(t, survey.Survey{ID: first.SurveyID})
	if err := f.store.SaveReadings(f.ctx, second.ID, nil, []survey.CopyReading{
		{CopyNumber: 1, Marks: []survey.Mark{{QuestionID: q.ID, AlternativeID: q.Alternatives[1].ID}}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.store.CloseRun(f.ctx, second.SurveyID, second.ID, f.now); err != nil {
		t.Fatal(err)
	}
	tallies, err := f.store.ClosedRunTallies(f.ctx, first.SurveyID)
	if err != nil || len(tallies) != 2 {
		t.Fatalf("tallies = %+v, %v", tallies, err)
	}
	by := map[int64]survey.ClosedRunTally{}
	for _, rt := range tallies {
		by[rt.Run.ID] = rt
	}
	a, b := by[first.ID].Tally, by[second.ID].Tally
	if a.Copies != 3 || a.ReadCopies != 3 || a.Counts[q.Alternatives[1].ID] != 1 || a.Answered[ctx.ID] != 3 {
		t.Errorf("first run = %+v", a)
	}
	if b.Copies != 1 || b.ReadCopies != 1 || b.Counts[q.Alternatives[1].ID] != 1 || b.Answered[ctx.ID] != 0 {
		t.Errorf("second run = %+v", b)
	}
	if !by[second.ID].Printed[q.ID] || !by[first.ID].Printed[ctx.ID] {
		t.Error("a run lost what it printed")
	}
}
