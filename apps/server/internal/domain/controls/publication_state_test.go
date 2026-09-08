package controls_test

import (
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// The four per-copy publication states (issue #287 §2), derived rather
// than stored.
//
// A stored fifth column would have to be invalidated on every re-read,
// every re-annotation and every override, and would be wrong for the whole
// window between the change and the invalidation. Deriving costs one
// comparison and cannot go stale, which is the point.

// stateRig is the world a copy's state is derived against: who is enrolled
// and which copies have an annotated PDF on record. One place to break one
// thing in, the publishRig shape.
func stateRig() (controls.Control, map[int64]controls.Recipient, map[int]controls.AnnotatedCopy) {
	courseID := int64(4)
	control := controls.Control{
		ID: "CTRLSTATE00000000000000A", Name: "Control 2",
		QuestionsPerCopy: 2, Copies: 3,
		State: controls.Graded, CourseID: &courseID,
	}
	recipients := map[int64]controls.Recipient{
		10: {FirstName: "ANA", LastName: "SOTO VERA", Email: "ana@udp.cl"},
	}
	return control, recipients, map[int]controls.AnnotatedCopy{
		1: {ControlID: control.ID, CopyNumber: 1, Path: "anotado-1.pdf"},
	}
}

// gradedReading is a matched, fully-answered copy of ANA's — the shape a
// publication sends, and the baseline every case below breaks one thing in.
func gradedReading() controls.Reading {
	studentID := int64(10)
	return controls.Reading{
		ID: 1, ControlID: "CTRLSTATE00000000000000A", CopyNumber: 1,
		StudentID:  &studentID,
		RUTStatus:  controls.RUTStatusOK,
		CopyStatus: controls.CopyStatusOK,
		Answers: []controls.Answer{
			{QuestionRef: "q1", Status: controls.AnswerStatusOK, Score: 1, Max: 1},
			{QuestionRef: "q2", Status: controls.AnswerStatusOK, Score: 1, Max: 1},
		},
	}
}

func TestACopyNobodyWroteToIsNotSentAndOffersItsGrade(t *testing.T) {
	control, recipients, annotated := stateRig()

	got := controls.CopyPublicationFor(control, gradedReading(), recipients, annotated)

	if got.State != controls.CopyNotSent {
		t.Errorf("state = %q, want %q", got.State, controls.CopyNotSent)
	}
	if got.PublishedAt != nil {
		t.Errorf("PublishedAt = %v, want nil on a copy nobody wrote to", got.PublishedAt)
	}
	// The grade it WOULD carry, which is what makes the state actionable:
	// the row can offer "Enviar" and say what would go out.
	if got.Grade != "7.0" {
		t.Errorf("Grade = %q, want the grade this copy would be sent with", got.Grade)
	}
}

func TestACopySentWithTheGradeItStillHasIsSent(t *testing.T) {
	control, recipients, annotated := stateRig()
	reading := gradedReading()
	sentAt := time.Unix(1_757_264_400, 0).UTC()
	reading.PublishedAt = &sentAt
	reading.PublishedGrade = "7.0"

	got := controls.CopyPublicationFor(control, reading, recipients, annotated)

	if got.State != controls.CopySent {
		t.Errorf("state = %q, want %q", got.State, controls.CopySent)
	}
	if got.PublishedAt == nil || !got.PublishedAt.Equal(sentAt) {
		t.Errorf("PublishedAt = %v, want %v", got.PublishedAt, sentAt)
	}
}

// The case the professor's re-correction produces: they fixed a grade
// after publishing, and that one person is now holding an out-of-date
// correction.
//
// Detected on the GRADE and not on the annotated PDF's timestamp: Reanalyze
// calls ClearAnnotated and re-annotates every clean copy, so one global
// re-read at another sensitivity would mark the whole class stale even
// where nothing a student can see moved (#287 §3).
func TestACopyWhoseGradeMovedAfterItsSendIsStale(t *testing.T) {
	control, recipients, annotated := stateRig()
	reading := gradedReading()
	sentAt := time.Unix(1_757_264_400, 0).UTC()
	reading.PublishedAt = &sentAt
	reading.PublishedGrade = "4.0"

	got := controls.CopyPublicationFor(control, reading, recipients, annotated)

	if got.State != controls.CopyStale {
		t.Errorf("state = %q, want %q — this copy went out with %q and now grades %q",
			got.State, controls.CopyStale, reading.PublishedGrade, got.Grade)
	}
	if got.SentGrade != "4.0" {
		t.Errorf("SentGrade = %q, want the grade that actually went out", got.SentGrade)
	}
	if got.Grade != "7.0" {
		t.Errorf("Grade = %q, want the grade a re-send would carry", got.Grade)
	}
}

// Every shape of "there is nothing to send", one per reason, in one table.
//
// Each row breaks exactly ONE thing in the baseline, so a reason reported
// for the wrong cause fails here rather than reading as a pass — the same
// discipline the schema's refusal cases carry.
func TestACopyThatCannotBeDeliveredIsSkippedAndNamesWhy(t *testing.T) {
	control, recipients, annotated := stateRig()

	cases := []struct {
		name   string
		break_ func(*controls.Reading)
		want   controls.CopySkipReason
	}{
		{
			name:   "nobody was matched to the copy",
			break_: func(r *controls.Reading) { r.StudentID = nil },
			want:   controls.SkipNoStudent,
		},
		{
			name: "the matched person is not on the course roster",
			break_: func(r *controls.Reading) {
				stranger := int64(999)
				r.StudentID = &stranger
			},
			want: controls.SkipNoStudent,
		},
		{
			name: "the copy was never handed in, so it has no grade",
			break_: func(r *controls.Reading) {
				r.CopyStatus = controls.CopyStatusNotPresent
			},
			want: controls.SkipNoGrade,
		},
		{
			name:   "the copy has no annotated PDF to attach",
			break_: func(r *controls.Reading) { r.CopyNumber = 2 },
			want:   controls.SkipNoAnnotated,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			reading := gradedReading()
			c.break_(&reading)

			got := controls.CopyPublicationFor(control, reading, recipients, annotated)

			if got.State != controls.CopySkipped {
				t.Fatalf("state = %q, want %q", got.State, controls.CopySkipped)
			}
			if got.SkipReason != c.want {
				t.Errorf("reason = %q, want %q", got.SkipReason, c.want)
			}
		})
	}
}

// A copy that WAS sent and has since stopped being deliverable stays
// "enviado" (issue #287).
//
// The student dropped the course, or an override turned their grade into a
// dash. Neither un-sends the mail they are holding, and reporting "omitido"
// would tell the professor nobody wrote to somebody who has the correction
// in their inbox — the same "NULL is not zero" mistake #273's count column
// exists to prevent, one layer down.
func TestASentCopyThatStoppedBeingDeliverableIsStillReportedSent(t *testing.T) {
	control, recipients, annotated := stateRig()
	reading := gradedReading()
	sentAt := time.Unix(1_757_264_400, 0).UTC()
	reading.PublishedAt = &sentAt
	reading.PublishedGrade = "7.0"
	// She withdrew after the publication went out.
	delete(recipients, 10)

	got := controls.CopyPublicationFor(control, reading, recipients, annotated)

	if got.State != controls.CopySent {
		t.Errorf("state = %q, want %q — she is holding the correction whatever the roster says now",
			got.State, controls.CopySent)
	}
	if got.SentGrade != "7.0" {
		t.Errorf("SentGrade = %q, want the grade that went out", got.SentGrade)
	}
}

// THE REGRESSION (issue #287, found while writing the resume cases).
//
// Service.Publish built its message with FormatGrade(NumericGrade(…)),
// composing two functions that are not composable: NumericGrade already
// returns the 1,0–7,0 grade and FormatGrade maps a RAW TOTAL onto that
// scale, so the second re-scaled the first's answer and clamped everything
// re-scaling the true grade as though it were a raw score out of the
// question count: too HIGH on a short control (a copy with 1 of 2 correct
// read 4,0 in the readings table and was EMAILED 7,0) and too LOW on a long
// one (a real 7,0 emails as 5,2 out of ten questions). It shipped in #273
// and went out to a real class on 2026-09-08.
//
// The case below asserts the two surfaces AGREE rather than asserting a
// number, deliberately: two earlier attempts to state the threshold in
// prose were both wrong, in opposite directions.
//
// The assertion is against TotalAndGrade rather than against a literal,
// because the claim is not "the grade is 4,0" — it is that the professor's
// table and the student's email cannot disagree, which is what #251's rule
// says and what the comment on rawTotal already claimed.
func TestTheGradeAMessageCarriesIsTheOneTheReadingsTableShows(t *testing.T) {
	control, recipients, annotated := stateRig()

	for _, correct := range []struct {
		name  string
		score float64
	}{
		{"nothing right", 0},
		{"half right", 1},
		{"everything right", 2},
	} {
		t.Run(correct.name, func(t *testing.T) {
			reading := gradedReading()
			reading.Answers[0].Score = 0
			reading.Answers[1].Score = 0
			for i := 0; i < int(correct.score); i++ {
				reading.Answers[i].Score = 1
			}

			_, onTheTable := controls.TotalAndGrade(control.QuestionsPerCopy, reading)
			got := controls.CopyPublicationFor(control, reading, recipients, annotated)

			if got.Grade != onTheTable {
				t.Errorf("the message would carry %q while the readings table shows %q",
					got.Grade, onTheTable)
			}
		})
	}
}
