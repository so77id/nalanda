package controls_test

import (
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// The grade math (§C7 + ADR-0031) is load-bearing; this pins the
// boundary values so a future edit that shifts the rounding, the
// clamp direction or the override contract turns the suite red.

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
		{total: 5, questions: 4, want: "7.0"},  // out-of-range clamp high
		{total: -1, questions: 4, want: "1.0"}, // negative → clamp low
	}
	for _, c := range cases {
		if got := controls.FormatGrade(c.total, c.questions); got != c.want {
			t.Errorf("FormatGrade(%v, %d) = %q, want %q", c.total, c.questions, got, c.want)
		}
	}
}

func TestTotalAndGradeSumsRelativeScores(t *testing.T) {
	// A copy with q1 simple (1.0 relative) and q2 multiple (3/4 = 0.75)
	// totals 1.75/2 → 87.5% → 6.25 rendered with %.1f → 6.2.
	r := controls.Reading{
		RUTStatus: controls.RUTStatusOK,
		Answers: []controls.Answer{
			{QuestionRef: "q1", QuestionType: controls.QuestionSimple,
				Status: controls.AnswerStatusOK, Score: 1, Max: 1},
			{QuestionRef: "q2", QuestionType: controls.QuestionMultiple,
				Status: controls.AnswerStatusOK, Score: 3, Max: 4},
		},
	}
	total, grade := controls.TotalAndGrade(2, r)
	if total != "1.75/2" || grade != "6.2" {
		t.Errorf("TotalAndGrade = (%s, %s), want (1.75/2, 6.2)", total, grade)
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
	total, grade := controls.TotalAndGrade(1, r)
	if total != "—" || grade != "—" {
		t.Errorf("TotalAndGrade = (%s, %s), want (—, —)", total, grade)
	}
}

func TestTotalAndGradeOverrideAwardsFullPoint(t *testing.T) {
	// AC-4: an override earns the whole point regardless of AMC's own
	// score. Documented behaviour, not a bug.
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
	total, _ := controls.TotalAndGrade(1, r)
	if total != "1.00/1" {
		t.Errorf("overridden answer total = %s, want 1.00/1", total)
	}
}

func TestTotalAndGradeReturnsDashesForNotPresent(t *testing.T) {
	r := controls.Reading{
		CopyStatus: controls.CopyStatusNotPresent,
		RUTStatus:  controls.RUTStatusNotPresent,
	}
	total, grade := controls.TotalAndGrade(4, r)
	if total != "—" || grade != "—" {
		t.Errorf("TotalAndGrade(not_present) = (%s, %s), want (—, —)", total, grade)
	}
}
