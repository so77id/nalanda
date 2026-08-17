package handler

import (
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// The grade math (§C7 + ADR-0031) is load-bearing and the results-table
// tests only exercised the estado column. This file pins the numeric
// outputs at the boundary values.

func TestFormatGradeMapsPercentageOntoTheChileanScale(t *testing.T) {
	cases := []struct {
		total     float64
		questions int
		want      string
	}{
		{total: 0, questions: 4, want: "1.0"},  // 0%
		{total: 2, questions: 4, want: "4.0"},  // 50%
		{total: 4, questions: 4, want: "7.0"},  // 100%
		{total: 1, questions: 4, want: "2.5"},  // 25%
		{total: 3, questions: 4, want: "5.5"},  // 75%
		{total: 0, questions: 0, want: "—"},    // guard: no questions drawn
		{total: 5, questions: 4, want: "7.0"},  // out-of-range clamp (defensive)
		{total: -1, questions: 4, want: "1.0"}, // negative → clamp low
	}
	for _, c := range cases {
		if got := formatGrade(c.total, c.questions); got != c.want {
			t.Errorf("formatGrade(%v, %d) = %q, want %q", c.total, c.questions, got, c.want)
		}
	}
}

func TestTotalAndGradeSumsRelativeScores(t *testing.T) {
	// A copy with q1 simple (1.0 relative) and q2 multiple (3/4 = 0.75)
	// totals 1.75/2 → 87.5% → 6.25 rounded to 6.3.
	r := controls.Reading{
		RUTStatus: controls.RUTStatusOK,
		Answers: []controls.Answer{
			{QuestionRef: "q1", QuestionType: controls.QuestionSimple,
				Status: controls.AnswerStatusOK, Score: 1, Max: 1},
			{QuestionRef: "q2", QuestionType: controls.QuestionMultiple,
				Status: controls.AnswerStatusOK, Score: 3, Max: 4},
		},
	}
	total, grade := totalAndGrade(2, r)
	// pct = 0.875 → 4 + 6*(0.375) = 6.25, rendered with %.1f (IEEE 754
	// nearest-even) → 6.2.
	if total != "1.75/2" || grade != "6.2" {
		t.Errorf("totalAndGrade = (%s, %s), want (1.75/2, 6.2)", total, grade)
	}
}

func TestTotalAndGradeReturnsDashesWhenAnswerIsDoubtfulWithoutOverride(t *testing.T) {
	r := controls.Reading{
		RUTStatus: controls.RUTStatusOK,
		Answers: []controls.Answer{
			{QuestionRef: "q1", QuestionType: controls.QuestionSimple,
				Status: controls.AnswerStatusDoubtful, Score: 0, Max: 1},
		},
	}
	total, grade := totalAndGrade(1, r)
	if total != "—" || grade != "—" {
		t.Errorf("totalAndGrade = (%s, %s), want (—, —)", total, grade)
	}
}

func TestTotalAndGradeOverrideAwardsFullPoint(t *testing.T) {
	// AC-4 override contract: an override earns the whole point,
	// regardless of AMC's own score. Documented behaviour, not a bug.
	r := controls.Reading{
		RUTStatus: controls.RUTStatusOK,
		Answers: []controls.Answer{
			{QuestionRef: "q1", QuestionType: controls.QuestionMultiple,
				Status: controls.AnswerStatusOK, Score: 3, Max: 4,
				Override: &controls.AnswerOverride{
					Marked: []int{1, 2}, Status: controls.AnswerStatusOK,
				}},
		},
	}
	total, _ := totalAndGrade(1, r)
	if total != "1.00/1" {
		t.Errorf("overridden answer total = %s, want 1.00/1", total)
	}
}

func TestTotalAndGradeReturnsDashesForNotPresent(t *testing.T) {
	r := controls.Reading{
		CopyStatus: controls.CopyStatusNotPresent,
		RUTStatus:  controls.RUTStatusNotPresent,
	}
	total, grade := totalAndGrade(4, r)
	if total != "—" || grade != "—" {
		t.Errorf("totalAndGrade(not_present) = (%s, %s), want (—, —)", total, grade)
	}
}
