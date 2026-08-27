package stats_test

import (
	"math"
	"reflect"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls/stats"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// The stats package is engine-independent (ADR-0031 like the grade math it
// builds on): the same shape survives a change of analyzer. These tests pin
// the global metrics against realistic reading shapes so a future edit that
// shifts the aggregation or the exclusion rules turns the suite red before
// the panel silently disagrees with the readings table (issue #251).

// reading builds a minimally-populated Reading with the answers a caller
// hands in and a numeric grade computable via NumericGrade — enough
// scaffolding for global-metric tests without duplicating the domain
// constructors.
func reading(copyNumber int, answers []controls.Answer) controls.Reading {
	return controls.Reading{
		CopyNumber: copyNumber,
		RUTStatus:  controls.RUTStatusOK,
		CopyStatus: controls.CopyStatusOK,
		Answers:    answers,
	}
}

// simpleOK is a valid answer on a simple question that scored `score`
// (0 or 1 for a simple item; float for a multiple graded engine-side).
func simpleOK(ref string, score float64) controls.Answer {
	return controls.Answer{
		QuestionRef:  ref,
		QuestionType: controls.QuestionSimple,
		Status:       controls.AnswerStatusOK,
		Score:        score,
		Max:          1,
	}
}

func TestComputeReturnsZeroNOnEmptyReadings(t *testing.T) {
	s := stats.Compute(nil, nil, 4)
	if s.Global.N != 0 {
		t.Errorf("Global.N = %d, want 0", s.Global.N)
	}
	if s.Global.TotalCopies != 0 {
		t.Errorf("Global.TotalCopies = %d, want 0", s.Global.TotalCopies)
	}
}

func TestComputeCountsOnlyValidGrades(t *testing.T) {
	// Five copies: one graded, one not_present, one blank RUT
	// unreadable, one doubtful without override, one graded. Only the
	// two with defined grades count toward N; TotalCopies is still 5
	// so "N rendidos = 2 (de 5 copias)" surfaces the difference (AC-3).
	readings := []controls.Reading{
		reading(1, []controls.Answer{simpleOK("q1", 1), simpleOK("q2", 1)}),
		{CopyNumber: 2, CopyStatus: controls.CopyStatusNotPresent, RUTStatus: controls.RUTStatusNotPresent},
		{CopyNumber: 3, CopyStatus: controls.CopyStatusNeedsReview, RUTStatus: controls.RUTStatusUnreadable},
		reading(4, []controls.Answer{
			{QuestionRef: "q1", QuestionType: controls.QuestionSimple, Status: controls.AnswerStatusDoubtful, Score: 0, Max: 1},
			simpleOK("q2", 0),
		}),
		reading(5, []controls.Answer{simpleOK("q1", 0), simpleOK("q2", 1)}),
	}
	s := stats.Compute(readings, nil, 2)
	if s.Global.N != 2 {
		t.Errorf("Global.N = %d, want 2 (only two copies have a defined grade)", s.Global.N)
	}
	if s.Global.TotalCopies != 5 {
		t.Errorf("Global.TotalCopies = %d, want 5", s.Global.TotalCopies)
	}
}

func TestComputeGlobalMean(t *testing.T) {
	// Two copies: 2/2 → 7.0, and 1/2 → 4.0. Mean = 5.5.
	readings := []controls.Reading{
		reading(1, []controls.Answer{simpleOK("q1", 1), simpleOK("q2", 1)}),
		reading(2, []controls.Answer{simpleOK("q1", 1), simpleOK("q2", 0)}),
	}
	s := stats.Compute(readings, nil, 2)
	if !closeEnough(s.Global.Mean, 5.5) {
		t.Errorf("Global.Mean = %v, want 5.5", s.Global.Mean)
	}
}

func TestComputeGlobalMedianOnOddCountUsesMiddleValue(t *testing.T) {
	// Grades 4.0, 5.5, 7.0 → median 5.5.
	readings := []controls.Reading{
		reading(1, []controls.Answer{simpleOK("q1", 1), simpleOK("q2", 0)}), // 4.0
		reading(2, []controls.Answer{simpleOK("q1", 1), simpleOK("q2", 1)}), // 7.0
		reading(3, []controls.Answer{
			simpleOK("q1", 1), simpleOK("q2", 0), simpleOK("q3", 1), simpleOK("q4", 0), // 4.0? no: 2/4 = 50% → 4.0
		}),
	}
	// For copy 3: 2/4 = 50% → 4.0. So sorted grades = [4.0, 4.0, 7.0], median 4.0.
	s := stats.Compute(readings, nil, 4) // sample: pin at questionsPerCopy=4
	// But copies 1 and 2 have questionsPerCopy=2 answers, so their grade
	// under `questions=4` is Σ(scores)/4 → both grades change. That is
	// on purpose: questionsPerCopy is a per-control invariant, and a
	// caller must pass the control's real value. Redo with all four:
	four := []controls.Reading{
		reading(1, []controls.Answer{ // 1/4 → 25% → 2.5
			simpleOK("q1", 1), simpleOK("q2", 0), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(2, []controls.Answer{ // 2/4 → 50% → 4.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(3, []controls.Answer{ // 3/4 → 75% → 5.5
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1), simpleOK("q4", 0),
		}),
	}
	s = stats.Compute(four, nil, 4)
	if !closeEnough(s.Global.Median, 4.0) {
		t.Errorf("Global.Median = %v, want 4.0", s.Global.Median)
	}
}

func TestComputeGlobalMedianOnEvenCountAveragesMiddleTwo(t *testing.T) {
	// Grades 2.5, 4.0, 5.5, 7.0 → median (4.0+5.5)/2 = 4.75.
	four := []controls.Reading{
		reading(1, []controls.Answer{ // 1/4 → 2.5
			simpleOK("q1", 1), simpleOK("q2", 0), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(2, []controls.Answer{ // 2/4 → 4.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(3, []controls.Answer{ // 3/4 → 5.5
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1), simpleOK("q4", 0),
		}),
		reading(4, []controls.Answer{ // 4/4 → 7.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1), simpleOK("q4", 1),
		}),
	}
	s := stats.Compute(four, nil, 4)
	if !closeEnough(s.Global.Median, 4.75) {
		t.Errorf("Global.Median = %v, want 4.75", s.Global.Median)
	}
}

func TestComputeGlobalModeSurfacesTiesAsAllValues(t *testing.T) {
	// Two 4.0s, two 5.5s → the mode is both (bimodal). The panel wants
	// every peak, not one chosen arbitrarily.
	four := []controls.Reading{
		reading(1, []controls.Answer{ // 2/4 → 4.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(2, []controls.Answer{ // 2/4 → 4.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(3, []controls.Answer{ // 3/4 → 5.5
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1), simpleOK("q4", 0),
		}),
		reading(4, []controls.Answer{ // 3/4 → 5.5
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1), simpleOK("q4", 0),
		}),
	}
	s := stats.Compute(four, nil, 4)
	want := []float64{4.0, 5.5}
	if !reflect.DeepEqual(s.Global.Mode, want) {
		t.Errorf("Global.Mode = %v, want %v", s.Global.Mode, want)
	}
}

func TestComputeGlobalStdDevIsPopulation(t *testing.T) {
	// Grades 4.0 and 7.0. Population stddev = sqrt(((4-5.5)^2 + (7-5.5)^2)/2) = 1.5.
	four := []controls.Reading{
		reading(1, []controls.Answer{ // 2/4 → 4.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(2, []controls.Answer{ // 4/4 → 7.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1), simpleOK("q4", 1),
		}),
	}
	s := stats.Compute(four, nil, 4)
	if !closeEnough(s.Global.StdDev, 1.5) {
		t.Errorf("Global.StdDev = %v, want 1.5 (population)", s.Global.StdDev)
	}
}

func TestComputeGlobalMinMaxRange(t *testing.T) {
	four := []controls.Reading{
		reading(1, []controls.Answer{ // 1/4 → 2.5
			simpleOK("q1", 1), simpleOK("q2", 0), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(2, []controls.Answer{ // 4/4 → 7.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1), simpleOK("q4", 1),
		}),
	}
	s := stats.Compute(four, nil, 4)
	if !closeEnough(s.Global.Min, 2.5) || !closeEnough(s.Global.Max, 7.0) || !closeEnough(s.Global.Range, 4.5) {
		t.Errorf("Global (Min,Max,Range) = (%v,%v,%v), want (2.5, 7.0, 4.5)",
			s.Global.Min, s.Global.Max, s.Global.Range)
	}
}

func TestComputeGlobalPercentageBucketsUseChileanThresholds(t *testing.T) {
	// Four grades: 2.5 (reprobación grave), 4.0 (aprobación), 4.5, 6.5 (excelencia).
	four := []controls.Reading{
		reading(1, []controls.Answer{ // 1/4 → 2.5
			simpleOK("q1", 1), simpleOK("q2", 0), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(2, []controls.Answer{ // 2/4 → 4.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(3, []controls.Answer{ // 2.333/4 → ~4.5 (58.33% → 4.5)
			// 2.333/4 = 58.33% → 4.0 + 6*(0.5833-0.5) = 4.0 + 0.5 = 4.5
			simpleOK("q1", 1), simpleOK("q2", 1),
			{QuestionRef: "q3", QuestionType: controls.QuestionMultiple, Status: controls.AnswerStatusOK, Score: 1, Max: 3},
			simpleOK("q4", 0),
		}),
		reading(4, []controls.Answer{ // 3.5/4 → 87.5% → 6.25 (>6.0 excelencia)
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1),
			{QuestionRef: "q4", QuestionType: controls.QuestionMultiple, Status: controls.AnswerStatusOK, Score: 1, Max: 2},
		}),
	}
	s := stats.Compute(four, nil, 4)
	// NotaCorte = 4.0: 3 of 4 → 75%.
	// Excelencia = 6.0: 1 of 4 → 25%.
	// ReprobacionGrave = < 3.0: 1 of 4 → 25%.
	if !closeEnough(s.Global.PctAprobacion, 75.0) {
		t.Errorf("PctAprobacion = %v, want 75.0", s.Global.PctAprobacion)
	}
	if !closeEnough(s.Global.PctExcelencia, 25.0) {
		t.Errorf("PctExcelencia = %v, want 25.0", s.Global.PctExcelencia)
	}
	if !closeEnough(s.Global.PctReprobacionGrave, 25.0) {
		t.Errorf("PctReprobacionGrave = %v, want 25.0", s.Global.PctReprobacionGrave)
	}
}

func TestComputeUsesBankParameterWithoutCrashingOnNil(t *testing.T) {
	// S1 does not use the bank; it must still accept nil without a
	// panic, so S3 can grow item analysis without renaming.
	readings := []controls.Reading{
		reading(1, []controls.Answer{simpleOK("q1", 1)}),
	}
	_ = stats.Compute(readings, (*bank.Bank)(nil), 1)
}

func TestConstantsMatchChileanConvention(t *testing.T) {
	if stats.NotaCorte != 4.0 {
		t.Errorf("NotaCorte = %v, want 4.0", stats.NotaCorte)
	}
	if stats.Excelencia != 6.0 {
		t.Errorf("Excelencia = %v, want 6.0", stats.Excelencia)
	}
	if stats.ReprobacionGrave != 3.0 {
		t.Errorf("ReprobacionGrave = %v, want 3.0", stats.ReprobacionGrave)
	}
}

func closeEnough(a, b float64) bool {
	return math.Abs(a-b) < 1e-6
}
