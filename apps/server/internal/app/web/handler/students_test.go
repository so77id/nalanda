package handler_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
)

// --- Issue #272 S8: one person's record. ---

// The page shows who they are and what they got, and the grade is the one
// the control page shows.
//
// AC9. The grade is asserted as a VALUE rather than as "some number":
// #251 recorded that every grade in this app flows through one
// computation, and a professor who reads 5.4 here and 5.5 on the control
// has no way to tell which is the grade.
func TestTheStudentPageListsTheirControlsAndGrades(t *testing.T) {
	f := newStudentsFixture()
	f.roster.student = roster.Student{
		ID: 42, FirstName: "Ana", LastName: "Pérez",
		Email: "ana@mail.udp.cl", RUT: "20100001", RUTDV: "5",
	}
	f.record.controls = []controls.StudentControl{
		gradedStudentControl("CTRLDOS0000000000000000AAA", "Control 2", 4, 4),
		gradedStudentControl("CTRLUNO0000000000000000AAA", "Control 1", 4, 2),
	}

	body := f.show(t, 42, http.StatusOK)

	for _, want := range []string{
		"Ana Pérez",
		"20.100.001-5", // formatted the way a Chilean reads it
		"ana@mail.udp.cl",
		"Control 1", "Control 2",
		"/controls/CTRLUNO0000000000000000AAA", // each row links to its control
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the student page does not carry %q:\n%s", want, body)
		}
	}

	// Four of four is a 7.0; two of four is the midpoint of the scale.
	// Whatever the scale says, it has to be TotalAndGrade's answer.
	for _, sc := range f.record.controls {
		_, grade := controls.TotalAndGrade(sc.Control.QuestionsPerCopy, sc.Reading)
		if !strings.Contains(body, grade) {
			t.Errorf("the page does not show grade %q for %q", grade, sc.Control.Name)
		}
	}
}

// A person with no copies is told which of the two things happened.
//
// Either they have not sat a control, or their copies never matched their
// RUT — and the second is actionable while the first is not. An empty
// table would say neither.
func TestAStudentWithNoCopiesIsToldWhy(t *testing.T) {
	f := newStudentsFixture()
	f.roster.student = roster.Student{ID: 42, FirstName: "Ana", LastName: "Pérez", RUT: "20100001", RUTDV: "5"}

	body := f.show(t, 42, http.StatusOK)
	if !strings.Contains(body, "no se ha emparejado") {
		t.Errorf("the empty state does not mention the unmatched case:\n%s", body)
	}
}

// A person Canvas held no RUT for is SAID to have none.
//
// An empty cell is a gap a reader can miss; "sin RUT" is the sentence
// that explains why none of their copies will ever appear here. Same
// reasoning as the roster page's dash (ADR-0069 §Decision 2).
func TestAStudentWithNoRutSaysSo(t *testing.T) {
	f := newStudentsFixture()
	f.roster.student = roster.Student{ID: 42, FirstName: "Ana", LastName: "Pérez"}

	body := f.show(t, 42, http.StatusOK)
	if !strings.Contains(body, "sin RUT") {
		t.Errorf("a student with no RUT does not say so:\n%s", body)
	}
}

// A student id nothing answers to is a 404, and so is a malformed one.
func TestAStudentPageForSomebodyWhoDoesNotExistIs404(t *testing.T) {
	for _, c := range []struct {
		name string
		id   string
		fail error
	}{
		{name: "unknown id", id: "4242", fail: roster.ErrStudentNotFound},
		{name: "not a number", id: "abc"},
		{name: "zero", id: "0"},
		{name: "negative", id: "-1"},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := newStudentsFixture()
			f.roster.fail = c.fail

			req := httptest.NewRequest(http.MethodGet, "/students/"+c.id, nil)
			req.SetPathValue("id", c.id)
			rec := httptest.NewRecorder()
			f.handler.Show(rec, req)

			if rec.Code != http.StatusNotFound {
				t.Errorf("status = %d, want 404", rec.Code)
			}
		})
	}
}

// A failed read of the record is a 500, not a page claiming the person
// sat nothing.
//
// The two look identical and mean opposite things: one sends the
// professor to check a RUT, the other is an outage. Rendering the first
// for the second would have them hunting a copy that is filed correctly.
func TestAStudentPageWhoseRecordCannotBeReadIs500(t *testing.T) {
	f := newStudentsFixture()
	f.roster.student = roster.Student{ID: 42, FirstName: "Ana", LastName: "Pérez", RUT: "20100001", RUTDV: "5"}
	f.record.fail = errors.New("the database is gone")

	body := f.show(t, 42, http.StatusInternalServerError)
	if strings.Contains(body, "no se ha emparejado") {
		t.Error("a failed read rendered as 'this person sat nothing'")
	}
}

// --- fixture ---------------------------------------------------------

type studentsFixture struct {
	handler *handler.Students
	roster  *fakeStudentReader
	record  *fakeStudentRecord
}

func newStudentsFixture() *studentsFixture {
	r := &fakeStudentReader{}
	rec := &fakeStudentRecord{}
	return &studentsFixture{
		handler: handler.NewStudents(handler.Students{Roster: r, Record: rec, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}),
		roster:  r,
		record:  rec,
	}
}

func (f *studentsFixture) show(t *testing.T, id int64, wantStatus int) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, handler.StudentPathFor(id), nil)
	req.SetPathValue("id", strconv.FormatInt(id, 10))
	rec := httptest.NewRecorder()
	f.handler.Show(rec, req)
	if rec.Code != wantStatus {
		t.Fatalf("status = %d, want %d; body:\n%s", rec.Code, wantStatus, rec.Body.String())
	}
	return rec.Body.String()
}

type fakeStudentReader struct {
	student roster.Student
	fail    error
}

func (f *fakeStudentReader) Student(context.Context, int64) (roster.Student, error) {
	if f.fail != nil {
		return roster.Student{}, f.fail
	}
	return f.student, nil
}

type fakeStudentRecord struct {
	controls []controls.StudentControl
	fail     error
}

func (f *fakeStudentRecord) ControlsForStudent(context.Context, int64) ([]controls.StudentControl, error) {
	return f.controls, f.fail
}

// gradedStudentControl builds one row: a control of `questions` questions
// and a reading that got `correct` of them, scored the way AMC scores a
// simple question (one point each).
func gradedStudentControl(id, name string, questions, correct int) controls.StudentControl {
	reading := controls.Reading{
		ID: 1, ControlID: id, CopyNumber: 1,
		RUTStatus: controls.RUTStatusOK, CopyStatus: controls.CopyStatusOK,
	}
	for i := range questions {
		score := 0.0
		if i < correct {
			score = 1
		}
		reading.Answers = append(reading.Answers, controls.Answer{
			QuestionRef:  fmt.Sprintf("q%d", i+1),
			QuestionType: controls.QuestionSimple,
			Status:       controls.AnswerStatusOK,
			Score:        score,
			Max:          1,
		})
	}
	return controls.StudentControl{
		Control: controls.Control{
			ID: id, Name: name, QuestionsPerCopy: questions,
			Copies: 30, State: controls.Graded,
		},
		Reading: reading,
	}
}
