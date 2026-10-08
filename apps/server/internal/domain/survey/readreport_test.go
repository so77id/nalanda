package survey_test

import (
	"errors"
	"reflect"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// Issue #311 S2: a report becomes marks and review items through the
// question NAME and the answer NUMBER, never through where a question or
// a box happened to sit.

// s0Bank is the S0 sheet's bank (apps/amc-worker/tests/08-survey.sh):
// q1 single of 3, q2 scale of 5, q3 multi of 4, q4 single of 4. Alternative
// ids are question*10 + position, so a wrong mapping shows in the id.
func s0Bank() []survey.Question {
	q := func(id int64, kind survey.QuestionKind, n int) survey.Question {
		out := survey.Question{ID: id, Kind: kind}
		for p := 1; p <= n; p++ {
			out.Alternatives = append(out.Alternatives, survey.Alternative{ID: id*10 + int64(p), Position: p})
		}
		return out
	}
	return []survey.Question{
		q(1, survey.KindSingle, 3), q(2, survey.KindScale, 5), q(3, survey.KindMulti, 4), q(4, survey.KindSingle, 4),
	}
}

func TestEachAnswerStatusBecomesMarksOrAnItem(t *testing.T) {
	report := survey.Report{Copies: []survey.ReportCopy{{
		CopyNumber: 2, Pages: []int{1},
		Answers: []survey.ReportAnswer{
			{Name: "q1", Status: survey.AnswerAmbiguous, Marked: []int{1, 2}},
			{Name: "q2", Status: survey.AnswerDoubtful, Doubtful: []int{4}},
			{Name: "q3", Status: survey.AnswerOK, Marked: []int{1, 3, 4}},
			{Name: "q4", Status: survey.AnswerBlank},
		},
	}}}
	got, err := survey.ReadReport(report, s0Bank())
	if err != nil {
		t.Fatalf("ReadReport: %v", err)
	}
	want := []survey.CopyReading{{
		CopyNumber: 2, Pages: []int{1},
		Marks: []survey.Mark{{QuestionID: 3, AlternativeID: 31}, {QuestionID: 3, AlternativeID: 33}, {QuestionID: 3, AlternativeID: 34}},
		Items: []survey.ReviewItemDraft{
			{QuestionID: 1, Reason: survey.ReasonAmbiguous, Marked: []int64{11, 12}},
			{QuestionID: 2, Reason: survey.ReasonDoubtful, Doubtful: []int64{24}},
		},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ReadReport =\n%+v\nwant\n%+v", got, want)
	}
}

// A confident mark with a faint one beside it is doubtful too: the
// student may have erased the wrong one, so NOTHING is recorded for it
// until the professor decides — not even the confident mark.
func TestADoubtfulAnswerWithAConfidentMarkRecordsNothingYet(t *testing.T) {
	report := survey.Report{Copies: []survey.ReportCopy{{CopyNumber: 1, Answers: []survey.ReportAnswer{
		{Name: "q4", Status: survey.AnswerDoubtful, Marked: []int{2}, Doubtful: []int{3}},
	}}}}
	got, err := survey.ReadReport(report, s0Bank())
	if err != nil {
		t.Fatalf("ReadReport: %v", err)
	}
	if len(got[0].Marks) != 0 || len(got[0].Items) != 1 ||
		!reflect.DeepEqual(got[0].Items[0], survey.ReviewItemDraft{QuestionID: 4, Reason: survey.ReasonDoubtful, Marked: []int64{42}, Doubtful: []int64{43}}) {
		t.Errorf("got %+v", got[0])
	}
}

func TestAReportThatIsNotOfThisSheetIsRefused(t *testing.T) {
	for name, answer := range map[string]survey.ReportAnswer{
		"a question the run never printed":       {Name: "q99", Status: survey.AnswerOK, Marked: []int{1}},
		"a name that is not a survey question":   {Name: "Pregunta 1", Status: survey.AnswerOK, Marked: []int{1}},
		"an answer number past the alternatives": {Name: "q1", Status: survey.AnswerOK, Marked: []int{4}},
		"a doubtful number past them":            {Name: "q1", Status: survey.AnswerDoubtful, Doubtful: []int{0}},
		"a status nobody defined":                {Name: "q1", Status: "maybe", Marked: []int{1}},
	} {
		report := survey.Report{Copies: []survey.ReportCopy{{CopyNumber: 1, Answers: []survey.ReportAnswer{answer}}}}
		if _, err := survey.ReadReport(report, s0Bank()); !errors.Is(err, survey.ErrReportMismatch) {
			t.Errorf("%s: %v, want ErrReportMismatch", name, err)
		}
	}
}
