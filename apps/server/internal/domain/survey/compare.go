package survey

import (
	"context"
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

// ParseMetric reads a metric's name; anything else is the mean.
func ParseMetric(name string) Metric {
	switch m := Metric(name); m {
	case MetricMode, MetricMedian:
		return m
	}
	return MetricMean
}

// ClosedRunTally is one closed run's counts, and which questions it printed.
type ClosedRunTally struct {
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
	// marked in the latest run that printed the question AND has a mark on
	// it (ties: bank order); nil on scale and context rows, or when no run
	// marked it at all.
	Reference *Alternative
	// Percent says the values are percentages (single, multi), so Δ is in
	// points; otherwise they are the scale metric.
	Percent bool
	Cells   []ComparisonCell
	// Delta is the value in the last run with one minus the value in the
	// first; nil with fewer than two values. Shown with its sign and an
	// arrow, never a colour: the
	// system does not know which direction is good.
	Delta *float64
}

// ComparisonCell is one run's value; Present false shows "—": the run did
// not print the question, or nobody answered a single or scale question.
// A multi-select over read copies has a value even when nobody ticked it
// (0 %, ADR-0082 §3).
type ComparisonCell struct {
	Value   float64
	Present bool
}

// Compare builds the table. A scale's mode is its lowest tied mode — a
// table cell holds one number; the run's own page lists every tie.
func Compare(bank []Question, runs []ClosedRunTally, metric Metric) Comparison {
	ordered := append([]ClosedRunTally(nil), runs...)
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
// the question and marked it at all — a later run nobody answered it in
// must not blank the earlier ones (#312 review, COR-2).
func reference(q Question, ordered []ClosedRunTally) *Alternative {
	alts := byPosition(q.Alternatives)
	for i := len(ordered) - 1; i >= 0; i-- {
		if !ordered[i].Printed[q.ID] {
			continue
		}
		var best *Alternative
		top := 0
		for k := range alts {
			if c := ordered[i].Tally.Counts[alts[k].ID]; c > top {
				top, best = c, &alts[k]
			}
		}
		if best != nil {
			return best
		}
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

// ComparisonSection is a run of consecutive rows sharing a section label.
type ComparisonSection struct {
	Label string
	Rows  []ComparisonRow
}

// Sections groups a comparison's rows the way the bank groups questions.
func (c Comparison) Sections() []ComparisonSection {
	var out []ComparisonSection
	for _, r := range c.Rows {
		if n := len(out); n > 0 && out[n-1].Label == r.Question.Section {
			out[n-1].Rows = append(out[n-1].Rows, r)
			continue
		}
		out = append(out, ComparisonSection{Label: r.Question.Section, Rows: []ComparisonRow{r}})
	}
	return out
}

// Compare builds screen 13 for a survey's closed runs: three reads — the
// bank, the run list and the one aggregate over every closed run.
func (s *Service) Compare(ctx context.Context, surveyID int64, metric Metric) (Comparison, error) {
	bank, err := s.Store.Questions(ctx, surveyID)
	if err != nil {
		return Comparison{}, err
	}
	tallies, err := s.Store.ClosedRunTallies(ctx, surveyID)
	if err != nil {
		return Comparison{}, err
	}
	return Compare(bank, tallies, metric), nil
}
