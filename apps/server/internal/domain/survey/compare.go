package survey

import (
	"sort"
)

// The comparison across a survey's closed runs (issue #312, screen 13):
// one row per question some closed run printed, one cell per run, and Δ.

// Metric is what a scale row compares.
type Metric string

const (
	MetricMean   Metric = "mean"
	MetricMode   Metric = "mode"
	MetricMedian Metric = "median"
)

// RunTally is one closed run's counts, and which questions it printed.
type RunTally struct {
	Run     Run
	Printed map[int64]bool
	Tally   Tally
}

// Comparison is screen 13's table.
type Comparison struct {
	// Runs are the columns, oldest number first.
	Runs []Run
	// Rows are in bank order.
	Rows []ComparisonRow
}

// ComparisonRow is one question across the runs.
type ComparisonRow struct {
	Question Question
	// Context rows compare nothing: they are what results are filtered by.
	Context bool
	// Reference is the alternative a single or multi row follows — the most
	// marked in the latest run that printed the question (ties: bank
	// order); nil on scale and context rows.
	Reference *Alternative
	// Percent says the values are percentages (single, multi), so Δ is in
	// points; otherwise they are the scale metric.
	Percent bool
	Cells   []ComparisonCell
	// Delta is the value in the last run with one minus the value in the
	// first; nil with fewer than two values. Only its sign is shown: the
	// system does not know which direction is good.
	Delta *float64
}

// ComparisonCell is one run's value; Present false shows "—" (the run did
// not print the question, or nobody answered it).
type ComparisonCell struct {
	Value   float64
	Present bool
}

// Compare builds the table. A scale's mode is its lowest tied mode — a
// table cell holds one number; the run's own page lists every tie.
func Compare(bank []Question, runs []RunTally, metric Metric) Comparison {
	ordered := append([]RunTally(nil), runs...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Run.Number < ordered[j].Run.Number })
	out := Comparison{}
	for _, r := range ordered {
		out.Runs = append(out.Runs, r.Run)
	}
	questions := append([]Question(nil), bank...)
	sort.Slice(questions, func(i, j int) bool { return questions[i].Position < questions[j].Position })

	for _, q := range questions {
		printedAnywhere := false
		for _, r := range ordered {
			printedAnywhere = printedAnywhere || r.Printed[q.ID]
		}
		if !printedAnywhere {
			continue
		}
		row := ComparisonRow{Question: q, Context: q.IsContext, Cells: make([]ComparisonCell, len(ordered))}
		if q.IsContext {
			out.Rows = append(out.Rows, row)
			continue
		}
		if q.Kind != KindScale {
			row.Percent = true
			row.Reference = reference(q, ordered)
		}
		var values []float64
		for i, r := range ordered {
			if !r.Printed[q.ID] {
				continue
			}
			stats := StatsFor(q, r.Tally)
			v, ok := cellValue(stats, row.Reference, metric)
			if !ok {
				continue
			}
			row.Cells[i] = ComparisonCell{Value: v, Present: true}
			values = append(values, v)
		}
		if len(values) >= 2 {
			d := values[len(values)-1] - values[0]
			row.Delta = &d
		}
		out.Rows = append(out.Rows, row)
	}
	return out
}

// reference is the most-marked alternative in the latest run that printed
// the question; nil when that run marked none of them.
func reference(q Question, ordered []RunTally) *Alternative {
	for i := len(ordered) - 1; i >= 0; i-- {
		if !ordered[i].Printed[q.ID] {
			continue
		}
		alts := append([]Alternative(nil), q.Alternatives...)
		sort.Slice(alts, func(a, b int) bool { return alts[a].Position < alts[b].Position })
		var best *Alternative
		top := 0
		for k := range alts {
			if c := ordered[i].Tally.Counts[alts[k].ID]; c > top {
				top, best = c, &alts[k]
			}
		}
		return best
	}
	return nil
}

func cellValue(stats QuestionStats, ref *Alternative, metric Metric) (float64, bool) {
	if stats.Question.Kind == KindScale {
		if stats.Scale == nil {
			return 0, false
		}
		switch metric {
		case MetricMode:
			return float64(stats.Scale.Modes[0]), true
		case MetricMedian:
			return stats.Scale.Median, true
		}
		return stats.Scale.Mean, true
	}
	if ref == nil || stats.Base == 0 {
		return 0, false
	}
	for _, r := range stats.Rows {
		if r.Alternative.ID == ref.ID {
			return r.Percent, true
		}
	}
	return 0, false
}
