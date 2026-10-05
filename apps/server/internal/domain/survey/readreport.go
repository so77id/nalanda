package survey

import (
	"fmt"
	"sort"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey/tex"
)

// ReadReport turns a batch's report into what is stored per copy (issue
// #311), given the questions the run printed.
//
// A question is found by its AMC name, q<id> (tex.QuestionName), and an
// alternative by AMC's answer number — its 1-based position in the source,
// which is the bank's order: the sheet is printed unshuffled and the run
// locks the bank (ADR-0080 §2). Never by where a question or a box sat on
// the paper.
//
// Per answer:
//   - ok: one Mark per marked alternative.
//   - blank: nothing — "sin respuesta" is the absence of a mark.
//   - ambiguous, doubtful: one ReviewItemDraft carrying what was seen, and
//     NO mark, not even a confident one beside a faint one: the student
//     may have erased the wrong box, and that is the professor's call.
//
// The copy's own status, RUT and score are ignored (ADR-0080 §8). A name
// or an answer number the run never printed, or a status nobody defined,
// is ErrReportMismatch: the scans are not of this run's sheet, and storing
// half of them would be worse than storing none.
func ReadReport(report Report, printed []Question) ([]CopyReading, error) {
	byName := make(map[string]Question, len(printed))
	for _, q := range printed {
		alts := append([]Alternative(nil), q.Alternatives...)
		sort.Slice(alts, func(i, j int) bool { return alts[i].Position < alts[j].Position })
		q.Alternatives = alts
		byName[tex.QuestionName(q.ID)] = q
	}

	out := make([]CopyReading, 0, len(report.Copies))
	for _, c := range report.Copies {
		reading := CopyReading{CopyNumber: c.CopyNumber, Pages: c.Pages}
		for _, a := range c.Answers {
			q, ok := byName[a.Name]
			if !ok {
				return nil, fmt.Errorf("%w: copy %d answers %q, which this run did not print",
					ErrReportMismatch, c.CopyNumber, a.Name)
			}
			marked, err := alternativeIDs(q, a.Marked)
			if err != nil {
				return nil, fmt.Errorf("%w: copy %d, %s: %v", ErrReportMismatch, c.CopyNumber, a.Name, err)
			}
			doubtful, err := alternativeIDs(q, a.Doubtful)
			if err != nil {
				return nil, fmt.Errorf("%w: copy %d, %s: %v", ErrReportMismatch, c.CopyNumber, a.Name, err)
			}
			switch a.Status {
			case AnswerOK:
				for _, id := range marked {
					reading.Marks = append(reading.Marks, Mark{QuestionID: q.ID, AlternativeID: id})
				}
			case AnswerBlank:
			case AnswerAmbiguous, AnswerDoubtful:
				reason := ReasonDoubtful
				if a.Status == AnswerAmbiguous {
					reason = ReasonAmbiguous
				}
				reading.Items = append(reading.Items, ReviewItemDraft{
					QuestionID: q.ID, Reason: reason, Marked: marked, Doubtful: doubtful,
				})
			default:
				return nil, fmt.Errorf("%w: copy %d, %s: unknown status %q",
					ErrReportMismatch, c.CopyNumber, a.Name, a.Status)
			}
		}
		out = append(out, reading)
	}
	return out, nil
}

// alternativeIDs maps AMC answer numbers to the question's alternative ids.
func alternativeIDs(q Question, numbers []int) ([]int64, error) {
	if len(numbers) == 0 {
		return nil, nil
	}
	ids := make([]int64, 0, len(numbers))
	for _, n := range numbers {
		if n < 1 || n > len(q.Alternatives) {
			return nil, fmt.Errorf("answer %d of %d alternatives", n, len(q.Alternatives))
		}
		ids = append(ids, q.Alternatives[n-1].ID)
	}
	return ids, nil
}
