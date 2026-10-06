package survey_test

import (
	"math"
	"reflect"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// Issue #312 S1: each kind's statistics over a tally of marks, with fixed
// fixtures (AC 1): ties in mode, an even-sized median, all-blank questions
// and an empty filter.

// question builds a question whose alternative ids are id*10 + position.
func question(id int64, kind survey.QuestionKind, labels ...string) survey.Question {
	q := survey.Question{ID: id, Kind: kind}
	for i, l := range labels {
		q.Alternatives = append(q.Alternatives, survey.Alternative{ID: id*10 + int64(i+1), Position: i + 1, Label: l})
	}
	return q
}

// tally is copies read, and per alternative id how many copies marked it;
// Answered is derived from the counts for single/scale (one mark per copy)
// unless given.
func tally(copies int, counts map[int64]int, answered map[int64]int) survey.Tally {
	return survey.Tally{Copies: copies, Counts: counts, Answered: answered}
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestASingleChoiceCountsOverTheCopiesThatAnswered(t *testing.T) {
	q := question(1, survey.KindSingle, "A", "B", "C")
	got := survey.StatsFor(q, tally(10, map[int64]int{11: 3, 12: 5}, map[int64]int{1: 8}))
	if got.Answered != 8 || got.Blank != 2 || got.Base != 8 {
		t.Fatalf("answered/blank/base = %d/%d/%d, want 8/2/8", got.Answered, got.Blank, got.Base)
	}
	want := []survey.AlternativeCount{{Alternative: q.Alternatives[0], Count: 3, Percent: 37.5},
		{Alternative: q.Alternatives[1], Count: 5, Percent: 62.5}, {Alternative: q.Alternatives[2], Count: 0, Percent: 0}}
	if !reflect.DeepEqual(got.Rows, want) {
		t.Errorf("rows = %+v", got.Rows)
	}
	if got.Scale != nil {
		t.Error("a single choice has no mean")
	}
}

func TestAScaleHasMeanMedianAndEveryTiedMode(t *testing.T) {
	q := question(2, survey.KindScale, "", "", "", "", "")
	// Values: 1×1, 2×3, 3×3, 4×1 → 8 answers, even-sized.
	got := survey.StatsFor(q, tally(9, map[int64]int{21: 1, 22: 3, 23: 3, 24: 1}, map[int64]int{2: 8}))
	if got.Scale == nil {
		t.Fatal("a scale has its statistics")
	}
	if !near(got.Scale.Mean, 2.5) {
		t.Errorf("mean = %v, want 2.5", got.Scale.Mean)
	}
	// Sorted: 1 2 2 2 3 3 3 4 — the 4th and 5th are 2 and 3.
	if !near(got.Scale.Median, 2.5) {
		t.Errorf("median = %v, want 2.5 (the mean of the two middle values)", got.Scale.Median)
	}
	if !reflect.DeepEqual(got.Scale.Modes, []int{2, 3}) {
		t.Errorf("modes = %v, want both tied values", got.Scale.Modes)
	}
	if len(got.Rows) != 5 || got.Rows[4].Count != 0 || got.Rows[0].Alternative.Position != 1 {
		t.Errorf("histogram rows = %+v, want all five points in order", got.Rows)
	}
}

func TestAMultiSelectIsOverEveryReadCopyAndSortedByFrequency(t *testing.T) {
	q := question(3, survey.KindMulti, "Heap", "BST", "Stack")
	got := survey.StatsFor(q, tally(20, map[int64]int{31: 5, 32: 12, 33: 5}, map[int64]int{3: 14}))
	if got.Base != 20 || got.Answered != 14 || got.Blank != 6 {
		t.Fatalf("base/answered/blank = %d/%d/%d, want 20/14/6", got.Base, got.Answered, got.Blank)
	}
	labels := []string{}
	for _, r := range got.Rows {
		labels = append(labels, r.Alternative.Label)
	}
	if !reflect.DeepEqual(labels, []string{"BST", "Heap", "Stack"}) || !near(got.Rows[0].Percent, 60) {
		t.Errorf("rows = %+v, want BST 60%% first, ties in bank order", got.Rows)
	}
}

func TestAnAllBlankQuestionAndAnEmptyFilter(t *testing.T) {
	scale := question(2, survey.KindScale, "", "", "")
	blank := survey.StatsFor(scale, tally(5, nil, nil))
	if blank.Answered != 0 || blank.Blank != 5 || blank.Scale != nil {
		t.Errorf("all blank = %+v, want no statistics and five blanks", blank)
	}
	for _, r := range blank.Rows {
		if r.Percent != 0 {
			t.Errorf("a percent over nothing: %+v", r)
		}
	}
	empty := survey.StatsFor(question(3, survey.KindMulti, "A", "B"), tally(0, nil, nil))
	if empty.Base != 0 || empty.Blank != 0 || len(empty.Rows) != 2 {
		t.Errorf("an empty filter = %+v, want zero copies and the rows still listed", empty)
	}
}
