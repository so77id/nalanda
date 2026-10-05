package survey_test

import (
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// Issue #312 S2: the question × run comparison (screen 13).

func runTally(number int, printed []int64, t survey.Tally) survey.RunTally {
	p := map[int64]bool{}
	for _, id := range printed {
		p[id] = true
	}
	return survey.RunTally{Run: survey.Run{ID: int64(100 + number), Number: number}, Printed: p, Tally: t}
}

func cellValues(row survey.ComparisonRow) []any {
	out := []any{}
	for _, c := range row.Cells {
		if c.Present {
			out = append(out, c.Value)
		} else {
			out = append(out, "—")
		}
	}
	return out
}

func TestTheComparisonFollowsTheRowRules(t *testing.T) {
	ctx := question(1, survey.KindSingle, "A", "B")
	ctx.IsContext = true
	scale := question(2, survey.KindScale, "", "", "", "", "")
	multi := question(3, survey.KindMulti, "Heap", "BST")
	late := question(4, survey.KindScale, "", "", "")
	never := question(5, survey.KindSingle, "Sí", "No")
	bank := []survey.Question{ctx, scale, multi, late, never}
	for i := range bank {
		bank[i].Position = i + 1
	}

	runs := []survey.RunTally{
		// Run 2 listed first on purpose: the comparison orders by number.
		runTally(2, []int64{1, 2, 3, 4}, survey.Tally{Copies: 10,
			Counts:   map[int64]int{11: 6, 12: 4, 24: 10, 31: 5, 32: 2, 43: 4},
			Answered: map[int64]int{1: 10, 2: 10, 3: 6, 4: 4}}),
		runTally(1, []int64{1, 2, 3}, survey.Tally{Copies: 4,
			Counts:   map[int64]int{11: 4, 22: 2, 23: 2, 31: 1, 32: 3},
			Answered: map[int64]int{1: 4, 2: 4, 3: 4}}),
	}
	got := survey.Compare(bank, runs, survey.MetricMean)

	if len(got.Runs) != 2 || got.Runs[0].Number != 1 || got.Runs[1].Number != 2 {
		t.Fatalf("runs = %+v, want #1 then #2", got.Runs)
	}
	if len(got.Rows) != 4 {
		t.Fatalf("%d rows, want 4 — a question no closed run printed has no row", len(got.Rows))
	}
	byID := map[int64]survey.ComparisonRow{}
	for _, r := range got.Rows {
		byID[r.Question.ID] = r
	}

	// Context: — everywhere.
	if c := byID[1]; !c.Context || c.Delta != nil || c.Cells[0].Present || c.Cells[1].Present {
		t.Errorf("context row = %+v", c)
	}
	// Scale, mean: run 1 = (2+2+3+3)/4 = 2.5; run 2 = 4. Δ = +1.5.
	if s := byID[2]; cellValues(s)[0] != 2.5 || cellValues(s)[1] != 4.0 || s.Delta == nil || *s.Delta != 1.5 {
		t.Errorf("scale row = %v, Δ %v", cellValues(s), s.Delta)
	}
	// Multi: the reference is the most-marked in the LATEST run with the
	// question (run 2: Heap, 5 of 10 copies = 50%); run 1's Heap is 1 of 4
	// copies = 25%. Δ in points: +25.
	m := byID[3]
	if m.Reference == nil || m.Reference.Label != "Heap" || !m.Percent {
		t.Fatalf("multi reference = %+v", m.Reference)
	}
	if cellValues(m)[0] != 25.0 || cellValues(m)[1] != 50.0 || *m.Delta != 25 {
		t.Errorf("multi row = %v, Δ %v", cellValues(m), *m.Delta)
	}
	// A question only the later run printed: — before it, no Δ with one value.
	if l := byID[4]; l.Cells[0].Present || !l.Cells[1].Present || l.Delta != nil {
		t.Errorf("late question = %v, Δ %v", cellValues(l), l.Delta)
	}
}

func TestTheScaleMetricIsSelectable(t *testing.T) {
	scale := question(2, survey.KindScale, "", "", "")
	runs := []survey.RunTally{runTally(1, []int64{2}, survey.Tally{Copies: 3,
		Counts: map[int64]int{21: 1, 23: 2}, Answered: map[int64]int{2: 3}})}
	for metric, want := range map[survey.Metric]float64{survey.MetricMean: 7.0 / 3, survey.MetricMedian: 3, survey.MetricMode: 3} {
		got := survey.Compare([]survey.Question{scale}, runs, metric)
		if v := got.Rows[0].Cells[0].Value; !near(v, want) {
			t.Errorf("%s = %v, want %v", metric, v, want)
		}
	}
	// A run where nobody answered the scale has no value.
	empty := []survey.RunTally{runTally(1, []int64{2}, survey.Tally{Copies: 3})}
	if c := survey.Compare([]survey.Question{scale}, empty, survey.MetricMean).Rows[0].Cells[0]; c.Present {
		t.Errorf("an unanswered scale has a value: %+v", c)
	}
}
