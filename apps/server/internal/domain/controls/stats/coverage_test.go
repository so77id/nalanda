package stats_test

import (
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls/stats"
)

// These tests widen coverage against AC-7's checklist: all-excluded,
// single valid reading, a realistic 40-copy batch with mixed statuses
// and overrides. The math is already pinned by the per-region tests;
// what this file protects is the boundary behaviour on the shapes the
// panel is likely to meet in production.

func TestComputeAllExcluded(t *testing.T) {
	// Three copies, none with a defined grade: one not_present, one
	// doubtful without override, one unreadable RUT without override.
	// TotalCopies = 3, N = 0, and every downstream summary comes back
	// zero-valued so the panel prints "no hay datos".
	readings := []controls.Reading{
		{CopyNumber: 1, CopyStatus: controls.CopyStatusNotPresent, RUTStatus: controls.RUTStatusNotPresent},
		reading(2, []controls.Answer{answerDoubtful("q1")}),
		{
			CopyNumber: 3,
			RUTStatus:  controls.RUTStatusUnreadable,
			CopyStatus: controls.CopyStatusNeedsReview,
			Answers:    []controls.Answer{answer("q1", 1)},
		},
	}
	s := stats.Compute(readings, nil, 1)
	if s.Global.N != 0 || s.Global.TotalCopies != 3 {
		t.Errorf("Global (N,TotalCopies) = (%d,%d), want (0,3)", s.Global.N, s.Global.TotalCopies)
	}
	if s.Histogram.Bins != nil {
		t.Errorf("Histogram.Bins = %v, want nil", s.Histogram.Bins)
	}
	if len(s.PerQuestion) != 0 {
		t.Errorf("PerQuestion len = %d, want 0", len(s.PerQuestion))
	}
}

func TestComputeSingleValidReading(t *testing.T) {
	// A control with one graded copy: min = max = grade, stddev = 0,
	// range = 0, mode = [grade]. The panel renders it as a one-column
	// histogram — the caller then decides whether to caption it.
	b := bankFor("q1", "simple", []int{0}, 4)
	readings := []controls.Reading{
		reading(1, []controls.Answer{answer("q1", 1)}), // 1/1 → 7.0
	}
	s := stats.Compute(readings, b, 1)
	if s.Global.N != 1 {
		t.Errorf("Global.N = %d, want 1", s.Global.N)
	}
	if !closeEnough(s.Global.Min, 7.0) || !closeEnough(s.Global.Max, 7.0) {
		t.Errorf("Global (Min,Max) = (%v,%v), want (7.0,7.0)", s.Global.Min, s.Global.Max)
	}
	if !closeEnough(s.Global.StdDev, 0) {
		t.Errorf("Global.StdDev = %v, want 0", s.Global.StdDev)
	}
	if !closeEnough(s.Global.Range, 0) {
		t.Errorf("Global.Range = %v, want 0", s.Global.Range)
	}
	// Discrimination is undefined for a single reading (all-correct).
	if len(s.PerQuestion) != 1 {
		t.Fatalf("PerQuestion len = %d, want 1", len(s.PerQuestion))
	}
	if s.PerQuestion[0].DiscriminacionDefined {
		t.Errorf("Discriminacion defined on a single-reading sample; want undefined")
	}
}

// TestCompute40CopyBatchWithMixedStatuses is the realistic shape check
// AC-7 asks for: enough copies to make percentages meaningful, mixed
// statuses (a few not_present, a couple of overrides), all answered
// against a small pool of authored questions. The invariants asserted
// are the ones the panel and the readings table can silently disagree
// on: N vs TotalCopies, the per-question sum-to-N for simple items,
// the histogram total counting every graded copy.
func TestCompute40CopyBatchWithMixedStatuses(t *testing.T) {
	// Two questions, both simple, correct = alternative 1 (mark 1).
	b := bankFor("q1", "simple", []int{0}, 4)
	// Bank only knows q1 — q2 is orphan, its stats still tally.

	var readings []controls.Reading
	// 30 copies fully graded. Correctness varies: 20 correct on q1,
	// 8 wrong (mark 2), 2 wrong (mark 3). q2: 25 correct, 5 blank.
	for i := 1; i <= 30; i++ {
		var a1 controls.Answer
		switch {
		case i <= 20:
			a1 = answer("q1", 1)
		case i <= 28:
			a1 = answerWrong("q1", 2)
		default:
			a1 = answerWrong("q1", 3)
		}
		var a2 controls.Answer
		if i <= 25 {
			a2 = answer("q2", 1)
		} else {
			a2 = answerBlank("q2")
		}
		readings = append(readings, reading(i, []controls.Answer{a1, a2}))
	}
	// 3 not_present copies: never scanned.
	for i := 31; i <= 33; i++ {
		readings = append(readings, controls.Reading{
			CopyNumber: i,
			CopyStatus: controls.CopyStatusNotPresent,
			RUTStatus:  controls.RUTStatusNotPresent,
		})
	}
	// 2 override copies: q1's mark was doubtful, professor gave the
	// point; q2 correct. Both graded, but q1 lands in Invalid for
	// distribution.
	for i := 34; i <= 35; i++ {
		readings = append(readings, reading(i, []controls.Answer{
			answerOverride("q1"),
			answer("q2", 1),
		}))
	}
	// 5 copies with doubtful q1 without override: excluded from N.
	for i := 36; i <= 40; i++ {
		readings = append(readings, reading(i, []controls.Answer{
			answerDoubtful("q1"),
			answer("q2", 1),
		}))
	}

	s := stats.Compute(readings, b, 2)
	if s.Global.TotalCopies != 40 {
		t.Errorf("TotalCopies = %d, want 40", s.Global.TotalCopies)
	}
	// N: 30 graded + 2 override + 0 excluded = 32.
	if s.Global.N != 32 {
		t.Errorf("N = %d, want 32", s.Global.N)
	}
	// Every histogram bin's count sums to N.
	total := 0
	for _, bin := range s.Histogram.Bins {
		total += bin.Count
	}
	if total != s.Global.N {
		t.Errorf("histogram total = %d, want N = %d", total, s.Global.N)
	}
	// Per-question tally for q1: sum-to-N invariant for simple items.
	var q1 stats.QuestionStats
	for _, q := range s.PerQuestion {
		if q.QuestionRef == "q1" {
			q1 = q
		}
	}
	if q1.N != 32 {
		t.Errorf("q1.N = %d, want 32", q1.N)
	}
	sum := q1.Blank + q1.Invalid
	for _, c := range q1.AltDistribution {
		sum += c
	}
	if sum != q1.N {
		t.Errorf("q1 distribution sum = %d, want N = %d", sum, q1.N)
	}
	// Dificultad: 20 raw correct + 2 override = 22. 22/32 = 68.75%.
	if !closeEnough(q1.Dificultad, 68.75) {
		t.Errorf("q1 Dificultad = %v, want 68.75", q1.Dificultad)
	}
	// PctErrada: 32 - 22 (fully correct incl. overrides) - 0 (no q1
	// blanks) = 10 → 31.25%. Pinned in the AC-7 shape after the review
	// caught the pre-fix formula subtracting Invalid twice
	// (issue #251 review, COR-1 / COR-2).
	if !closeEnough(q1.PctErrada, 31.25) {
		t.Errorf("q1 PctErrada = %v, want 31.25 (10 OK-wrong of 32)", q1.PctErrada)
	}
	// Three-bucket sum-to-100 invariant on the realistic batch.
	// Overrides live in Dificultad (grade math) AND Invalid (the
	// distribution's "cannot attribute to a letter" bucket) — the two
	// are not disjoint, so summing PctInvalid in would double-count.
	if got := q1.Dificultad + q1.PctErrada + q1.PctBlanco; !closeEnough(got, 100.0) {
		t.Errorf("q1 three-bucket sum = %v, want 100.0", got)
	}
}
