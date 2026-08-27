package stats_test

import (
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls/stats"
)

// Biserial-punto correlates per-question correctness against total
// grade — a positive value means the students who got the question
// right also scored higher overall, a negative one is a warning that
// the question ranks the class the wrong way round. AC-5: degenerate
// (all-correct or all-wrong across N) → DiscriminacionDefined=false,
// value stays at 0 and the panel prints "—" rather than a silent 0.

// TestDiscriminationPositiveWhenStrongLearnersMatchCorrect: two
// questions and four copies. Copy A/B get both right (grade 7.0),
// copy C gets q1 right q2 wrong (grade 4.0), copy D gets both wrong
// (grade 1.0). q1's correct group is {A,B,C}, its incorrect group is
// {D}. M_p = (7 + 7 + 4)/3 = 6.0, M_q = 1.0.
// mean_all = 19/4 = 4.75. Population variance =
//
//	((7-4.75)² + (7-4.75)² + (4-4.75)² + (1-4.75)²) / 4 = 6.1875
//
// σ = √6.1875 ≈ 2.4874686. p = 3/4, q = 1/4. r_pb =
// (6 - 1) / 2.4874686 · √(0.1875) ≈ 0.87038828.
func TestDiscriminationPositiveWhenStrongLearnersMatchCorrect(t *testing.T) {
	b := bankFor("q1", "simple", []int{0}, 4)
	// Copy A: right on q1 (mark 1); right on q2 (added via bank q2?)
	// but bank only knows q1. That is fine — the discrimination
	// computation only needs the per-question correctness on q1 and
	// the total grade of the copy.
	makeCopy := func(cn int, q1Right, q2Right bool) controls.Reading {
		mark1 := 1
		if !q1Right {
			mark1 = 2
		}
		mark2 := 1
		if !q2Right {
			mark2 = 2
		}
		return reading(cn, []controls.Answer{
			{
				QuestionRef:  "q1",
				QuestionType: controls.QuestionSimple,
				Status:       controls.AnswerStatusOK,
				Marked:       []int{mark1},
				Score:        boolTo01(q1Right),
				Max:          1,
			},
			{
				QuestionRef:  "q2",
				QuestionType: controls.QuestionSimple,
				Status:       controls.AnswerStatusOK,
				Marked:       []int{mark2},
				Score:        boolTo01(q2Right),
				Max:          1,
			},
		})
	}
	readings := []controls.Reading{
		makeCopy(1, true, true),
		makeCopy(2, true, true),
		makeCopy(3, true, false),
		makeCopy(4, false, false),
	}
	s := stats.Compute(readings, b, 2)
	var q1 stats.QuestionStats
	for _, q := range s.PerQuestion {
		if q.QuestionRef == "q1" {
			q1 = q
		}
	}
	if !q1.DiscriminacionDefined {
		t.Fatalf("q1 Discriminacion not defined; want defined")
	}
	if !closeEnough(q1.Discriminacion, 0.87038828) {
		t.Errorf("q1 Discriminacion = %v, want ~0.87038828", q1.Discriminacion)
	}
}

func TestDiscriminationUndefinedWhenAllCorrect(t *testing.T) {
	b := bankFor("q1", "simple", []int{0}, 4)
	readings := []controls.Reading{
		reading(1, []controls.Answer{answer("q1", 1)}),
		reading(2, []controls.Answer{answer("q1", 1)}),
	}
	s := stats.Compute(readings, b, 1)
	q1 := s.PerQuestion[0]
	if q1.DiscriminacionDefined {
		t.Errorf("Discriminacion defined for an all-correct sample; want undefined")
	}
}

func TestDiscriminationUndefinedWhenAllWrong(t *testing.T) {
	b := bankFor("q1", "simple", []int{0}, 4)
	readings := []controls.Reading{
		reading(1, []controls.Answer{answerWrong("q1", 2)}),
		reading(2, []controls.Answer{answerWrong("q1", 3)}),
	}
	s := stats.Compute(readings, b, 1)
	q1 := s.PerQuestion[0]
	if q1.DiscriminacionDefined {
		t.Errorf("Discriminacion defined for an all-wrong sample; want undefined")
	}
}

func TestDiscriminationUndefinedWhenTotalGradesAreConstant(t *testing.T) {
	// Everyone has the same total grade → σ = 0 → the correlation is
	// undefined (0/0). The panel must show "—", not a silent NaN or 0.
	b := bankFor("q1", "simple", []int{0}, 4)
	readings := []controls.Reading{
		reading(1, []controls.Answer{answer("q1", 1), answerWrong("q2", 2)}),
		reading(2, []controls.Answer{answerWrong("q1", 2), answer("q2", 1)}),
	}
	// Bank only knows q1; that is fine.
	s := stats.Compute(readings, b, 2)
	var q1 stats.QuestionStats
	for _, q := range s.PerQuestion {
		if q.QuestionRef == "q1" {
			q1 = q
		}
	}
	if q1.DiscriminacionDefined {
		t.Errorf("Discriminacion defined when σ=0; want undefined")
	}
}

func boolTo01(b bool) float64 {
	if b {
		return 1
	}
	return 0
}
