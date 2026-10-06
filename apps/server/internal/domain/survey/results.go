package survey

import (
	"context"
	"errors"
	"fmt"
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
	// ReadCopies is how many copies the run read, whatever the filter —
	// counted in the same query (#312 review, PERF-2).
	ReadCopies int
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
	alts := byPosition(q.Alternatives)

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

// ContextFilter restricts a run's results to the copies that marked one of
// AlternativeIDs on the context question QuestionID. With no alternative
// ticked the set is empty — a filter that admits nobody shows nobody.
type ContextFilter struct {
	QuestionID     int64
	AlternativeIDs []int64
}

// Results sentinels.
var (
	// ErrRunNotClosed refuses the results of a run that is not closed:
	// only closed runs count (ADR-0081 §7).
	ErrRunNotClosed = errors.New("survey: the run is not closed")
	// ErrBadFilter is a filter on a question that is not one of the run's
	// context questions, or on an alternative that is not that question's.
	ErrBadFilter = errors.New("survey: that filter does not apply to the run")
)

// ResultQuestion is one question's block on a run's page.
type ResultQuestion struct {
	// Number is the number the run printed it as.
	Number int
	Stats  QuestionStats
}

// ResultSection is a run of consecutive printed questions sharing a label.
type ResultSection struct {
	Label     string
	Questions []ResultQuestion
}

// RunResults is screen 7.
type RunResults struct {
	Run Run
	// ReadCopies is every copy the run read; Copies is how many the
	// filter kept (equal without a filter).
	ReadCopies int
	Copies     int
	Filter     *ContextFilter
	// Context are the run's printed context questions, the ones a filter
	// may use.
	Context  []Question
	Sections []ResultSection
}

// RunResults computes a closed run's page, maybe filtered by a context
// answer.
func (s *Service) RunResults(ctx context.Context, surveyID, runID int64, filter *ContextFilter) (RunResults, error) {
	run, err := s.Store.Run(ctx, surveyID, runID)
	if err != nil {
		return RunResults{}, err
	}
	if run.State != RunClosed {
		return RunResults{}, fmt.Errorf("survey: results of run %d: %w", runID, ErrRunNotClosed)
	}
	printed, numbers, err := s.printedInOrder(ctx, run)
	if err != nil {
		return RunResults{}, err
	}
	out := RunResults{Run: run, Filter: filter}
	for _, q := range printed {
		if q.IsContext {
			out.Context = append(out.Context, q)
		}
	}
	if filter != nil {
		if err := validFilter(out.Context, *filter); err != nil {
			return RunResults{}, err
		}
	}
	tally, err := s.Store.RunTally(ctx, run.ID, filter)
	if err != nil {
		return RunResults{}, err
	}
	out.ReadCopies, out.Copies = tally.ReadCopies, tally.Copies
	for _, sec := range Sections(printed) {
		rs := ResultSection{Label: sec.Label}
		for _, q := range sec.Questions {
			rs.Questions = append(rs.Questions, ResultQuestion{Number: numbers[q.ID], Stats: StatsFor(q, tally)})
		}
		out.Sections = append(out.Sections, rs)
	}
	return out, nil
}

func validFilter(context []Question, f ContextFilter) error {
	for _, q := range context {
		if q.ID != f.QuestionID {
			continue
		}
		own := map[int64]bool{}
		for _, a := range q.Alternatives {
			own[a.ID] = true
		}
		for _, a := range f.AlternativeIDs {
			if !own[a] {
				return fmt.Errorf("%w: alternative %d", ErrBadFilter, a)
			}
		}
		return nil
	}
	return fmt.Errorf("%w: question %d", ErrBadFilter, f.QuestionID)
}

// ClosedRuns are the survey's closed runs, newest number first — the run
// selector's choices.
func (s *Service) ClosedRuns(ctx context.Context, surveyID int64) ([]Run, error) {
	runs, err := s.Store.RunsForSurvey(ctx, surveyID)
	if err != nil {
		return nil, err
	}
	var out []Run
	for _, r := range runs {
		if r.State == RunClosed {
			out = append(out, r)
		}
	}
	return out, nil
}

// ErrQuestionNotInRun is a question the run did not print.
var ErrQuestionNotInRun = errors.New("survey: the run did not print that question")

// QuestionAcross is one closed run's view of a question; Stats is nil when
// that run did not print it.
type QuestionAcross struct {
	Run   Run
	Stats *QuestionStats
}

// QuestionResults is screen 6.
type QuestionResults struct {
	Run        Run
	Number     int
	Stats      QuestionStats
	Copies     int
	ReadCopies int
	Filter     *ContextFilter
	// Across are the survey's closed runs, oldest first, unfiltered.
	Across []QuestionAcross
}

// QuestionResults computes one question of a closed run, with the same
// filter as its run page, and its values in every closed run.
func (s *Service) QuestionResults(ctx context.Context, surveyID, runID, questionID int64, filter *ContextFilter) (QuestionResults, error) {
	page, err := s.RunResults(ctx, surveyID, runID, filter)
	if err != nil {
		return QuestionResults{}, err
	}
	out := QuestionResults{Run: page.Run, Copies: page.Copies, ReadCopies: page.ReadCopies, Filter: filter}
	found := false
	for _, sec := range page.Sections {
		for _, q := range sec.Questions {
			if q.Stats.Question.ID == questionID {
				out.Number, out.Stats, found = q.Number, q.Stats, true
			}
		}
	}
	if !found {
		return QuestionResults{}, fmt.Errorf("survey: question %d of run %d: %w", questionID, runID, ErrQuestionNotInRun)
	}
	tallies, err := s.Store.ClosedRunTallies(ctx, surveyID)
	if err != nil {
		return QuestionResults{}, err
	}
	sort.Slice(tallies, func(i, j int) bool { return tallies[i].Run.Number < tallies[j].Run.Number })
	for _, t := range tallies {
		across := QuestionAcross{Run: t.Run}
		if t.Printed[questionID] {
			st := StatsFor(out.Stats.Question, t.Tally)
			across.Stats = &st
		}
		out.Across = append(out.Across, across)
	}
	return out, nil
}

// RunAnswers is a closed run's raw answers: the questions it printed, in
// printed order with their numbers, and every copy's marks.
type RunAnswers struct {
	Run       Run
	Questions []Question
	Numbers   map[int64]int
	Copies    []CopyMarks
}

// RunAnswers reads a closed run's raw answers (the raw CSV).
func (s *Service) RunAnswers(ctx context.Context, surveyID, runID int64) (RunAnswers, error) {
	run, err := s.Store.Run(ctx, surveyID, runID)
	if err != nil {
		return RunAnswers{}, err
	}
	if run.State != RunClosed {
		return RunAnswers{}, fmt.Errorf("survey: answers of run %d: %w", runID, ErrRunNotClosed)
	}
	printed, numbers, err := s.printedInOrder(ctx, run)
	if err != nil {
		return RunAnswers{}, err
	}
	copies, err := s.Store.RunMarks(ctx, run.ID)
	if err != nil {
		return RunAnswers{}, err
	}
	return RunAnswers{Run: run, Questions: printed, Numbers: numbers, Copies: copies}, nil
}

// printedInOrder is printedQuestions sorted by the number each was printed
// as.
func (s *Service) printedInOrder(ctx context.Context, run Run) ([]Question, map[int64]int, error) {
	printed, numbers, err := s.printedQuestions(ctx, run)
	if err != nil {
		return nil, nil, err
	}
	sort.Slice(printed, func(i, j int) bool { return numbers[printed[i].ID] < numbers[printed[j].ID] })
	return printed, numbers, nil
}

// byPosition is a copy of alts in bank order.
func byPosition(alts []Alternative) []Alternative {
	out := append([]Alternative(nil), alts...)
	sort.Slice(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out
}
