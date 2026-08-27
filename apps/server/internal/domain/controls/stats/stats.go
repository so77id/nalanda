// Package stats aggregates a control's readings into the numbers the
// professor sees on `/controles/{id}` once the correction is closed
// (issue #251, ADR-0043 unaffected).
//
// The whole package is pure: `Compute` returns a `Statistics` value out
// of the readings, the bank snapshot and the control's per-copy
// question count, and does no I/O. Both delivery surfaces of
// apps/server (the professor's backoffice and, later, WP-G's grade
// publisher) can call it — the dependency rule stays intact, because
// the package sits under `internal/domain` and only imports its
// siblings.
//
// Every grade the panel shows flows through
// `controls.NumericGrade` — the same math the readings table uses via
// `controls.TotalAndGrade`. That is what lets the panel and the table
// agree row-by-row: a change to §C7 rounding or to ADR-0031 scoring
// moves both in the same commit.
package stats

import (
	"math"
	"sort"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// Chilean grading convention. The three thresholds are hardcoded here
// per the WP's non-goals (a per-control cut is a later WP). Documented
// as constants so a caller can render them beside the derived
// percentages ("aprobación (≥ 4,0)") without re-typing 4.0.
const (
	// NotaCorte is the passing floor on the 1–7 scale (§C7). Grades at
	// or above it count as "aprobados".
	NotaCorte = 4.0
	// Excelencia is the threshold for the "% excelencia" bucket —
	// grades at or above it are the top slice the professor watches for
	// distortions (a suspiciously flat distribution above 6.5, etc).
	Excelencia = 6.0
	// ReprobacionGrave is the ceiling of the low bucket — grades
	// strictly below it are the ones the professor may want to talk to
	// individually. Strict `<` on purpose: a 3.0 already counts as
	// "reprobado" but not "grave".
	ReprobacionGrave = 3.0
)

// Statistics is the whole panel's data. The nested sub-structs let the
// template pick out one region without threading every field through
// the top-level.
//
// Fields grow in later slices: Histogram/Boxplot land in S2, and
// PerQuestion in S3–S4. The Global shape is stable at S1.
type Statistics struct {
	Global Global
	// Histogram, Boxplot and PerQuestion arrive with later slices;
	// consumers already reading Global today do not have to change
	// when they land.
	Histogram   Histogram
	Boxplot     Boxplot
	PerQuestion []QuestionStats
}

// Global holds the class-level numbers. N is "rendidos": readings with
// a defined grade — excluding not_present copies, unreadable RUTs
// without an override and doubtful/ambiguous answers without an
// override (the same exclusion controls.NumericGrade applies).
// TotalCopies is the whole roster the readings came from (Y in "de Y
// copias"), so the panel can render the "N rendidos = X (de Y
// copias)" line explicitly (AC-3).
//
// All percentages are 0–100, not 0–1. Mode is a slice so a bimodal
// (or flatter) sample surfaces every peak — arbitrarily picking one
// would lie about a distribution the professor needs to see.
type Global struct {
	N                   int
	TotalCopies         int
	Mean                float64
	Median              float64
	Mode                []float64
	StdDev              float64
	Min                 float64
	Max                 float64
	Range               float64
	PctAprobacion       float64 // grades ≥ NotaCorte
	PctExcelencia       float64 // grades ≥ Excelencia
	PctReprobacionGrave float64 // grades < ReprobacionGrave
}

// Histogram bins the class's grades on 0.1 steps of the 1.0–7.0 scale
// so the panel can render a fixed 61-column bar chart without having to
// rescale between controls. MaxCount is the tallest column — a
// convenience for the template so it can size bars without walking the
// bins again.
type Histogram struct {
	Bins     []HistogramBin
	MaxCount int
}

// HistogramBin is one column of the histogram: the grade the column
// stands for (1.0, 1.1, … 7.0) and how many readings landed on it.
// Grades round to the same 0.1 the readings table renders — a reading
// shown as "6.2" adds to the 6.2 bin, whatever its underlying float.
type HistogramBin struct {
	Grade float64
	Count int
}

// Boxplot summarises the distribution as the five-number shape the
// template renders inline. WhiskerLow/High are the extreme non-outlier
// values inside the 1.5·IQR fences (Tukey); Outliers is every grade
// outside those fences, sorted ascending. Empty (zero-valued) when N =
// 0 — the caller then renders no boxplot at all rather than a fake
// one at 0.0.
type Boxplot struct {
	Q1          float64
	Median      float64
	Q3          float64
	WhiskerLow  float64
	WhiskerHigh float64
	Outliers    []float64
}

// QuestionStats is one row of the item-analysis table. All numbers
// are computed only across readings that made it into N (a copy
// dropped from the global sample is dropped from every question's
// sample too — AC-3).
//
// Dificultad is the percentage of copies that scored the full point:
// Score == Max for a raw answer, or an override (the professor's
// full-point decision, per TotalAndGrade's rule). PctErrada counts the
// OK-but-not-fully-correct rows; PctBlanco the blank rows. Together
// with the "inválida" bucket (override / doubtful / ambiguous — a
// copy that reached the item analysis under override still lands here
// for the distribution) the three shares sum to 100%.
//
// AltDistribution is a per-authoring-alternative tally. Each simple
// answer contributes one mark to exactly one column (AC-4); a
// multiple-question answer with two ticks contributes to two — the
// sum-to-N invariant is documented as "for simple questions". A copy
// whose answer is override / blank / doubtful / ambiguous contributes
// to Blank or Invalid instead.
//
// A question the reading refers to that the current bank snapshot
// does not know (authored, then removed after the control was
// frozen) still gets a row: Statement is empty, AltCount is 0,
// AltDistribution is nil, and the panel labels the row with
// QuestionRef so a reader sees which one has no metadata.
type QuestionStats struct {
	QuestionRef     string
	Statement       string
	Type            controls.QuestionType
	AltCount        int
	Correct         []int // 0-based authoring indices, from the bank
	N               int
	FullyCorrect    int
	AltDistribution []int
	Blank           int
	Invalid         int
	Dificultad      float64 // 100 * FullyCorrect / N
	PctBlanco       float64 // 100 * Blank / N
	PctErrada       float64 // 100 * (OK-but-wrong) / N
	// Discriminacion (S4) — biserial-punto correlation between per-question
	// correctness and total grade. Defined=false when the sample is
	// degenerate (all-correct or all-wrong across N).
	Discriminacion        float64
	DiscriminacionDefined bool
}

// Compute derives the Statistics for the readings of one control drawn
// over `questionsPerCopy` slots. `b` is the current bank snapshot;
// item analysis (S3–S4) needs it to know each question's alternative
// count and the correct answer. `b` may be nil today; S3 will require
// it and check.
//
// Compute never writes to the database, never touches the file system,
// never asks the worker anything and holds no cache (AC-6). Every call
// walks the readings again — the panel is server-rendered per request,
// and a graded control's readings do not change between requests.
func Compute(readings []controls.Reading, b *bank.Bank, questionsPerCopy int) Statistics {
	graded := make([]gradedReading, 0, len(readings))
	grades := make([]float64, 0, len(readings))
	for _, r := range readings {
		g, ok := controls.NumericGrade(questionsPerCopy, r)
		if !ok {
			continue
		}
		graded = append(graded, gradedReading{reading: r, grade: g})
		grades = append(grades, g)
	}

	g := Global{
		N:           len(grades),
		TotalCopies: len(readings),
	}
	if g.N == 0 {
		return Statistics{Global: g}
	}

	sorted := append([]float64(nil), grades...)
	sort.Float64s(sorted)

	g.Min = sorted[0]
	g.Max = sorted[len(sorted)-1]
	g.Range = g.Max - g.Min
	g.Mean = mean(sorted)
	g.Median = median(sorted)
	g.Mode = mode(sorted)
	g.StdDev = populationStdDev(sorted, g.Mean)

	var pass, excel, low int
	for _, v := range grades {
		if v >= NotaCorte {
			pass++
		}
		if v >= Excelencia {
			excel++
		}
		if v < ReprobacionGrave {
			low++
		}
	}
	g.PctAprobacion = pct(pass, g.N)
	g.PctExcelencia = pct(excel, g.N)
	g.PctReprobacionGrave = pct(low, g.N)

	perQuestion := make([]QuestionStats, 0)
	if len(graded) > 0 {
		refOrder := make([]string, 0)
		seen := make(map[string]int)
		for _, gr := range graded {
			for _, a := range gr.reading.Answers {
				if _, ok := seen[a.QuestionRef]; ok {
					continue
				}
				seen[a.QuestionRef] = len(refOrder)
				refOrder = append(refOrder, a.QuestionRef)
			}
		}
		perQuestion = make([]QuestionStats, len(refOrder))
		for i, ref := range refOrder {
			perQuestion[i] = itemStatsFor(ref, graded, b)
		}
	}

	return Statistics{
		Global:      g,
		Histogram:   histogram(grades),
		Boxplot:     boxplot(sorted),
		PerQuestion: perQuestion,
	}
}

// gradedReading pairs a reading with its computed numeric grade, so
// the item-analysis loop does not recompute the grade per question.
// Private — the shape is a package-internal working type.
type gradedReading struct {
	reading controls.Reading
	grade   float64
}

// itemStatsFor tallies one question across every graded reading. A
// reading that has no answer for `ref` is silently skipped — the pool
// of a control is fixed, but a reader that predates a schema tweak
// could in principle carry a subset. The tally is the truthful reply.
func itemStatsFor(ref string, graded []gradedReading, b *bank.Bank) QuestionStats {
	q := QuestionStats{QuestionRef: ref}
	if b != nil {
		if bq, ok := b.FindQuestion(ref); ok {
			q.Statement = bq.Statement
			q.Type = controls.QuestionType(bq.Type)
			q.AltCount = len(bq.Alternatives)
			q.Correct = append([]int(nil), bq.Correct...)
			q.AltDistribution = make([]int, q.AltCount)
		}
	}

	for _, gr := range graded {
		a, found := findAnswer(gr.reading.Answers, ref)
		if !found {
			continue
		}
		q.N++

		override := a.Override != nil
		effective := a.Status
		if override {
			effective = a.Override.Status
		}

		fullyCorrect := false
		switch {
		case override:
			// Override earns the full point per TotalAndGrade — the
			// panel counts it as correct. Distribution cannot attribute
			// it to a letter → Invalid.
			fullyCorrect = true
			q.Invalid++
		case effective == controls.AnswerStatusBlank:
			q.Blank++
		case effective == controls.AnswerStatusOK:
			if a.Max > 0 && a.Score >= a.Max {
				fullyCorrect = true
			}
			for _, m := range a.Marked {
				idx := m - 1
				if q.AltDistribution == nil || idx < 0 || idx >= len(q.AltDistribution) {
					continue
				}
				q.AltDistribution[idx]++
			}
		default:
			// Doubtful / ambiguous without override cannot appear here
			// (NumericGrade would have excluded the copy), but treat
			// defensively: Invalid.
			q.Invalid++
		}

		if fullyCorrect {
			q.FullyCorrect++
		}
	}

	if q.N > 0 {
		q.Dificultad = pct(q.FullyCorrect, q.N)
		q.PctBlanco = pct(q.Blank, q.N)
		wrong := q.N - q.FullyCorrect - q.Blank - q.Invalid
		if wrong < 0 {
			wrong = 0
		}
		q.PctErrada = pct(wrong, q.N)
		q.Discriminacion, q.DiscriminacionDefined = pointBiserial(ref, graded, q.N, q.FullyCorrect)
	}
	return q
}

// pointBiserial computes the biserial-punto correlation between
// per-question correctness (dichotomy: fully-correct vs everything
// else) and the total grade across the graded readings.
//
// Formula (standard point-biserial):
//
//	r_pb = (M_p - M_q) / σ * sqrt(p * q)
//
// where M_p and M_q are the mean grades of the "correct" and
// "incorrect" groups, σ is the population standard deviation of the
// grades across all graded copies, and p / q are the correct /
// incorrect proportions. Undefined when p ∈ {0, 1} (all-correct or
// all-wrong across the sample — no contrast between groups) and when
// σ = 0 (every copy scored the same total, so there is no variance
// for the correctness dichotomy to correlate with). AC-5: the panel
// prints "—" for both cases rather than a silent 0.
//
// The correctness dichotomy matches Dificultad (fully-correct rows,
// including overrides): consistency with the row the professor reads
// beside this one.
func pointBiserial(ref string, graded []gradedReading, n, correct int) (float64, bool) {
	if correct == 0 || correct == n {
		return 0, false
	}
	incorrect := n - correct
	var sumP, sumQ, sumAll float64
	for _, gr := range graded {
		a, ok := findAnswer(gr.reading.Answers, ref)
		if !ok {
			continue
		}
		sumAll += gr.grade
		if answerIsFullyCorrect(a) {
			sumP += gr.grade
		} else {
			sumQ += gr.grade
		}
	}
	meanAll := sumAll / float64(n)
	meanP := sumP / float64(correct)
	meanQ := sumQ / float64(incorrect)

	var variance float64
	for _, gr := range graded {
		if _, ok := findAnswer(gr.reading.Answers, ref); !ok {
			continue
		}
		d := gr.grade - meanAll
		variance += d * d
	}
	variance /= float64(n)
	if variance == 0 {
		return 0, false
	}
	sigma := math.Sqrt(variance)
	p := float64(correct) / float64(n)
	q := 1 - p
	r := (meanP - meanQ) / sigma * math.Sqrt(p*q)
	return r, true
}

// answerIsFullyCorrect is the same dichotomy Dificultad uses. Kept in
// one place so the two numbers cannot drift apart.
func answerIsFullyCorrect(a controls.Answer) bool {
	if a.Override != nil {
		return true
	}
	if a.Status == controls.AnswerStatusOK && a.Max > 0 && a.Score >= a.Max {
		return true
	}
	return false
}

func findAnswer(as []controls.Answer, ref string) (controls.Answer, bool) {
	for _, a := range as {
		if a.QuestionRef == ref {
			return a, true
		}
	}
	return controls.Answer{}, false
}

// histogram allocates the fixed 61-column bar chart (1.0 through 7.0
// inclusive by 0.1) and drops each grade into its rounded bin. A grade
// is rounded to one decimal — the same precision the readings table
// prints — so a reading shown as "6.2" adds to the 6.2 column.
func histogram(grades []float64) Histogram {
	if len(grades) == 0 {
		return Histogram{}
	}
	const bins = 61
	h := Histogram{Bins: make([]HistogramBin, bins)}
	for i := range h.Bins {
		h.Bins[i].Grade = 1.0 + 0.1*float64(i)
	}
	for _, g := range grades {
		idx := int(math.Round((g - 1.0) * 10))
		if idx < 0 {
			idx = 0
		}
		if idx >= bins {
			idx = bins - 1
		}
		h.Bins[idx].Count++
		if h.Bins[idx].Count > h.MaxCount {
			h.MaxCount = h.Bins[idx].Count
		}
	}
	return h
}

// boxplot computes the five-number summary and Tukey's 1.5·IQR
// outliers. `sorted` is already ascending. Q1 and Q3 use the
// median-of-halves rule (Tukey hinges): on an even N the halves split
// cleanly, on an odd N the true median is included in both halves.
// Whiskers are the extremes inside the fences, not the fences
// themselves — that is what makes the boxplot legible when nothing is
// an outlier.
func boxplot(sorted []float64) Boxplot {
	if len(sorted) == 0 {
		return Boxplot{}
	}
	var lower, upper []float64
	n := len(sorted)
	if n%2 == 0 {
		lower = sorted[:n/2]
		upper = sorted[n/2:]
	} else {
		lower = sorted[:n/2+1]
		upper = sorted[n/2:]
	}
	b := Boxplot{
		Q1:     median(lower),
		Median: median(sorted),
		Q3:     median(upper),
	}
	iqr := b.Q3 - b.Q1
	fenceLow := b.Q1 - 1.5*iqr
	fenceHigh := b.Q3 + 1.5*iqr
	// Whiskers: min/max inside the fences. Outliers everything else.
	b.WhiskerLow = math.Inf(+1)
	b.WhiskerHigh = math.Inf(-1)
	for _, v := range sorted {
		if v < fenceLow || v > fenceHigh {
			b.Outliers = append(b.Outliers, v)
			continue
		}
		if v < b.WhiskerLow {
			b.WhiskerLow = v
		}
		if v > b.WhiskerHigh {
			b.WhiskerHigh = v
		}
	}
	// A degenerate sample where every value is an outlier is
	// impossible (the fences straddle the hinges, which are inside
	// the data), but guard the whisker infinities anyway so a caller
	// rendering a max-height bar never divides by an infinity.
	if math.IsInf(b.WhiskerLow, +1) {
		b.WhiskerLow = b.Q1
	}
	if math.IsInf(b.WhiskerHigh, -1) {
		b.WhiskerHigh = b.Q3
	}
	return b
}

func mean(xs []float64) float64 {
	sum := 0.0
	for _, v := range xs {
		sum += v
	}
	return sum / float64(len(xs))
}

// median assumes xs is sorted ascending and non-empty. On an even
// count the middle two values are averaged, on an odd count the
// middle one is returned.
func median(sorted []float64) float64 {
	n := len(sorted)
	if n%2 == 1 {
		return sorted[n/2]
	}
	return (sorted[n/2-1] + sorted[n/2]) / 2
}

// mode returns every value that ties for the highest count, in
// ascending order. A wholly flat sample (every value distinct) returns
// every value — the caller may then choose to render "sin moda", but
// the math is honest.
func mode(sorted []float64) []float64 {
	counts := make(map[float64]int)
	for _, v := range sorted {
		counts[v]++
	}
	best := 0
	for _, c := range counts {
		if c > best {
			best = c
		}
	}
	var out []float64
	for v, c := range counts {
		if c == best {
			out = append(out, v)
		}
	}
	sort.Float64s(out)
	return out
}

// populationStdDev uses N (population) rather than N-1 (sample). The
// panel is describing THIS class's actual grades, not estimating a
// larger population's parameter from a sample: N is the whole
// observable universe of the control.
func populationStdDev(xs []float64, mean float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	sum := 0.0
	for _, v := range xs {
		d := v - mean
		sum += d * d
	}
	return math.Sqrt(sum / float64(len(xs)))
}

func pct(part, total int) float64 {
	if total == 0 {
		return 0
	}
	return 100 * float64(part) / float64(total)
}
