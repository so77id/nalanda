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
	if r.CopyStatus == CopyStatusNotPresent {
		return "—", "—"
	}
	if r.RUTStatus == RUTStatusUnreadable && r.RUTOverride == nil {
		return "—", "—"
	}
	total := 0.0
	for _, a := range r.Answers {
		effective := a.Status
		if a.Override != nil {
			effective = a.Override.Status
		}
		if effective == AnswerStatusDoubtful || effective == AnswerStatusAmbiguous {
			return "—", "—"
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
		return "—", "—"
	}
	return fmt.Sprintf("%.2f/%d", total, questions), FormatGrade(total, questions)
}

// FormatGrade maps a fraction onto the 1,0–7,0 scale: 4,0 at 50%,
// linear on either side (§C7). Rounded to one decimal. Negative or >1
// fractions are clamped — either would only appear from a scoring bug
// upstream, and a grade outside 1–7 has no reader.
func FormatGrade(total float64, questions int) string {
	if questions == 0 {
		return "—"
	}
	pct := total / float64(questions)
	var grade float64
	switch {
	case pct <= 0:
		grade = 1.0
	case pct <= 0.5:
		grade = 1.0 + 6.0*pct // 0.0→1.0, 0.5→4.0
	case pct >= 1.0:
		grade = 7.0
	default:
		grade = 4.0 + 6.0*(pct-0.5) // 0.5→4.0, 1.0→7.0
	}
	return fmt.Sprintf("%.1f", grade)
}
