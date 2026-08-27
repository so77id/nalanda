package controls

import "fmt"

// The grade math for a Reading, both surfaces of apps/server call it.
// Lives here so WP-G (publish grades, potentially on the JSON surface)
// and any future caller do not have to import internal/app/web to
// compute the same number. The pair (§C7 mapping + ADR-0031
// normalisation) is engine-independent and survives a change of engine
// unchanged, which is one of the two reasons ADR-0031 exists.

// TotalAndGrade computes the "Σ relative / N" total and its 1,0–7,0
// grade for a Reading over `questions` drawn slots. The rules mirror
// ADR-0031 §Every question weighs one point and 2026-08-controles.md
// §C7:
//
//   - a doubtful/ambiguous answer with no override → both dashes
//     ("—"/"—"): the number is unknown until the review is done.
//   - an unreadable RUT with no override → same reason, same output.
//   - a not_present copy → dashes.
//   - a blank answer → contributes 0 to the total (correctly zero, not
//     unknown).
//   - a normal answer → score/max fraction; max travels with the answer
//     because a multiple's max is its alternative count, not a constant.
//   - an overridden answer → 1.0 (the professor's decision is a whole
//     point, regardless of AMC's own score — the trust model of manual
//     grading).
//
// Returns raw like "1.75/2" and grade like "6.2", or "—"/"—" when
// unknown.
func TotalAndGrade(questions int, r Reading) (string, string) {
	total, _, ok := rawTotalAndGrade(questions, r)
	if !ok {
		return "—", "—"
	}
	return fmt.Sprintf("%.2f/%d", total, questions), FormatGrade(total, questions)
}

// NumericGrade returns the 1.0–7.0 grade for r drawn over `questions`
// slots as a float, with ok=false when the grade is unknown (dashes:
// doubtful/ambiguous without override, unreadable RUT without override,
// not_present, or questions=0). Same math as TotalAndGrade — this is the
// numeric back door for callers that need to compute statistics without
// string-parsing the formatted grade (issue #251, stats panel). Every
// number the panel shows flows through here, so the panel cannot
// disagree with the readings table.
func NumericGrade(questions int, r Reading) (float64, bool) {
	total, _, ok := rawTotalAndGrade(questions, r)
	if !ok {
		return 0, false
	}
	return numericGrade(total, questions), true
}

// rawTotalAndGrade is the shared numeric core. Returns (total, grade,
// ok=false) when the reading has no defined grade. Both TotalAndGrade
// (string) and NumericGrade (float) build on it — single source of the
// grade math per ADR-0031 and issue #251's cannot-disagree rule.
func rawTotalAndGrade(questions int, r Reading) (float64, float64, bool) {
	if r.CopyStatus == CopyStatusNotPresent {
		return 0, 0, false
	}
	if r.RUTStatus == RUTStatusUnreadable && r.RUTOverride == nil {
		return 0, 0, false
	}
	total := 0.0
	for _, a := range r.Answers {
		effective := a.Status
		if a.Override != nil {
			effective = a.Override.Status
		}
		if effective == AnswerStatusDoubtful || effective == AnswerStatusAmbiguous {
			return 0, 0, false
		}
		if effective == AnswerStatusBlank {
			continue
		}
		if a.Override != nil {
			total += 1.0
			continue
		}
		if a.Max > 0 {
			total += a.Score / a.Max
		}
	}
	if questions == 0 {
		return 0, 0, false
	}
	return total, numericGrade(total, questions), true
}

// FormatGrade maps a fraction onto the 1,0–7,0 scale: 4,0 at 50%,
// linear on either side (§C7). Rounded to one decimal. Negative or >1
// fractions are clamped — either would only appear from a scoring bug
// upstream, and a grade outside 1–7 has no reader.
func FormatGrade(total float64, questions int) string {
	if questions == 0 {
		return "—"
	}
	return fmt.Sprintf("%.1f", numericGrade(total, questions))
}

// numericGrade is the unrounded 1.0–7.0 mapping used by both FormatGrade
// (which then rounds) and NumericGrade (which does not). The one-decimal
// rounding is the renderer's concern, not the math's — a statistics
// mean over rounded grades would drift from the mean of the underlying
// scores.
func numericGrade(total float64, questions int) float64 {
	if questions == 0 {
		return 0
	}
	pct := total / float64(questions)
	switch {
	case pct <= 0:
		return 1.0
	case pct <= 0.5:
		return 1.0 + 6.0*pct // 0.0→1.0, 0.5→4.0
	case pct >= 1.0:
		return 7.0
	default:
		return 4.0 + 6.0*(pct-0.5) // 0.5→4.0, 1.0→7.0
	}
}
