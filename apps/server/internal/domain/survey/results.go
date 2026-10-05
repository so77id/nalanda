package survey

import (
	"sort"
)

// The results of a closed run (issue #312), computed at request time from
// counts — the store aggregates, the domain does the arithmetic. Named
// Tally / QuestionStats rather than Report: survey.Report is the worker's
// read report (ADR-0081).
//
// A question is ANSWERED on a copy when the copy has at least one mark for
// it; otherwise it is "sin respuesta" — blank on paper, discarded in
// review, or on a page never captured, all alike (ADR-0081 §2, §4).

// Tally is what the store counts over a set of copies (a closed run, maybe
// filtered by a context answer).
type Tally struct {
	// Copies is how many copies are in the set.
	Copies int
	// Counts is, per alternative id, how many copies of the set marked it.
	Counts map[int64]int
	// Answered is, per question id, how many copies of the set marked at
	// least one of its alternatives.
	Answered map[int64]int
}

// AlternativeCount is one alternative's row in a question's block.
type AlternativeCount struct {
	Alternative Alternative
	Count       int
	// Percent is Count over the question's Base, 0–100; 0 when the base
	// is empty.
	Percent float64
}

// ScaleStats are the numbers a scale question adds. A point's value is its
// position (1-based; the label may be empty).
type ScaleStats struct {
	Mean   float64
	Median float64
	// Modes are every value tied for the most answers, ascending.
	Modes []int
}

// QuestionStats is one question's block.
type QuestionStats struct {
	Question Question
	Answered int
	Blank    int
	// Base is what Percent is over: the copies that answered, for a single
	// or a scale question; every copy of the set, for a multi-select — a
	// student may tick none and still have read it.
	Base int
	// Rows are the alternatives: in bank order for single and scale (a
	// scale's histogram), by frequency for a multi-select (ties in bank
	// order).
	Rows []AlternativeCount
	// Scale is nil unless the question is a scale with at least one answer.
	Scale *ScaleStats
}

// StatsFor computes one question's block over a tally.
func StatsFor(q Question, t Tally) QuestionStats {
	alts := append([]Alternative(nil), q.Alternatives...)
	sort.Slice(alts, func(i, j int) bool { return alts[i].Position < alts[j].Position })

	out := QuestionStats{Question: q, Answered: t.Answered[q.ID]}
	out.Blank = t.Copies - out.Answered
	out.Base = out.Answered
	if q.Kind == KindMulti {
		out.Base = t.Copies
	}
	for _, a := range alts {
		row := AlternativeCount{Alternative: a, Count: t.Counts[a.ID]}
		if out.Base > 0 {
			row.Percent = float64(row.Count) * 100 / float64(out.Base)
		}
		out.Rows = append(out.Rows, row)
	}
	if q.Kind == KindMulti {
		sort.SliceStable(out.Rows, func(i, j int) bool { return out.Rows[i].Count > out.Rows[j].Count })
	}
	if q.Kind == KindScale {
		out.Scale = scaleStats(out.Rows)
	}
	return out
}

// scaleStats reads a histogram in position order; nil with no answers.
func scaleStats(rows []AlternativeCount) *ScaleStats {
	total, sum, top := 0, 0, 0
	for _, r := range rows {
		total += r.Count
		sum += r.Count * r.Alternative.Position
		if r.Count > top {
			top = r.Count
		}
	}
	if total == 0 {
		return nil
	}
	s := &ScaleStats{Mean: float64(sum) / float64(total)}
	for _, r := range rows {
		if r.Count == top {
			s.Modes = append(s.Modes, r.Alternative.Position)
		}
	}
	// The median: the value at 1-based rank (n+1)/2, or the mean of the two
	// middle ranks when n is even.
	nth := func(k int) int { // the value at 1-based rank k
		seen := 0
		for _, r := range rows {
			seen += r.Count
			if seen >= k {
				return r.Alternative.Position
			}
		}
		return rows[len(rows)-1].Alternative.Position
	}
	if total%2 == 1 {
		s.Median = float64(nth(total/2 + 1))
	} else {
		s.Median = float64(nth(total/2)+nth(total/2+1)) / 2
	}
	return s
}
