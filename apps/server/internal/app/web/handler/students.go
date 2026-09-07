package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
)

// The student screen's route (issue #272 S8). English path, Spanish page —
// the rule #150 set with /login.
//
// NOT nested under a course. A student is a PERSON here, shared across the
// courses they take (migration 00014), and this page shows their grades
// across every control they sat — a set no single course defines.
const StudentPath = "/students/{id}"

// StudentPathFor builds one student's URL. Exported so the templates and
// the redirects name the pattern once.
func StudentPathFor(id int64) string {
	return "/students/" + strconv.FormatInt(id, 10)
}

// StudentRecord is what this screen needs from the controls domain:
// everything one person sat. Satisfied by controls.Service.
//
// Its own port rather than a method on CourseControls, because that one
// is about a COURSE and this is about a person — the two screens ask
// different questions of the same domain and naming them apart is what
// keeps either from growing the other's methods.
type StudentRecord interface {
	ControlsForStudent(ctx context.Context, studentID int64) ([]controls.StudentControl, error)
}

// StudentReader is the person themselves. Satisfied by roster.Service.
type StudentReader interface {
	Student(ctx context.Context, id int64) (roster.Student, error)
}

var (
	_ StudentRecord = (*controls.Service)(nil)
	_ StudentReader = (*roster.Service)(nil)
)

// Students holds the student screen. Same shape as Courses and Professors.
type Students struct {
	Roster StudentReader
	Record StudentRecord
	Log    *slog.Logger
}

// NewStudents returns the handler.
func NewStudents(deps Students) *Students {
	switch {
	case deps.Roster == nil:
		panic("handler.NewStudents: no roster reader")
	case deps.Record == nil:
		panic("handler.NewStudents: no student record")
	case deps.Log == nil:
		panic("handler.NewStudents: no logger")
	}
	return &deps
}

// Show renders one student and their grades across every control they sat
// (issue #272 S8, AC9).
//
// The grade shown here is controls.TotalAndGrade's, the same function the
// control page's table calls. That is not a convenience: a professor who
// reads 5.4 on one screen and 5.5 on the other has no way to know which
// is the grade, and #251 already recorded that every grade in this app
// flows through one computation for exactly that reason.
func (s *Students) Show(w http.ResponseWriter, r *http.Request) {
	studentID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || studentID <= 0 {
		// A 404 rather than a 400: from the professor's side a URL that
		// does not name a person is a page that is not there, and the
		// difference between "malformed" and "absent" is one only the
		// server cares about. Same choice as Courses.courseIDFrom.
		middleware.WriteError(w, r, http.StatusNotFound, "Esa persona no existe.")
		return
	}

	student, err := s.Roster.Student(r.Context(), studentID)
	switch {
	case errors.Is(err, roster.ErrStudentNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Esa persona no existe.")
		return
	case err != nil:
		s.Log.Error("reading a student", "student", studentID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió al leer los datos del alumno. Vuelve a intentarlo en unos segundos.")
		return
	}

	sat, err := s.Record.ControlsForStudent(r.Context(), studentID)
	if err != nil {
		s.Log.Error("reading a student's controls", "student", studentID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió al leer los controles del alumno. Vuelve a intentarlo en unos segundos.")
		return
	}

	page := view.StudentPage{
		Page:     middleware.PageFor(r, studentName(student)),
		Name:     studentName(student),
		Email:    student.Email,
		RUT:      FormatRUT(student.RUT, student.RUTDV),
		HasRUT:   student.HasRUT(),
		Controls: make([]view.StudentControlRow, 0, len(sat)),
	}
	for _, one := range sat {
		total, grade := controls.TotalAndGrade(one.Control.QuestionsPerCopy, one.Reading)
		page.Controls = append(page.Controls, view.StudentControlRow{
			ControlName:     one.Control.Name,
			ApplicationDate: formatOptionalDate(one.Control.ApplicationDate),
			State:           stateWordControl(one.Control.State),
			TotalRaw:        total,
			Grade:           grade,
			ControlURL:      controlDetailURL(one.Control.ID),
			ReviewURL:       controlReviewURL(one.Control.ID, one.Reading.CopyNumber),
			// Issue #190's annotated PDF. The link is always rendered;
			// the endpoint itself answers 404 for a copy that was never
			// annotated, and putting a second copy of that policy here
			// would be a second place for it to drift (the review page
			// makes the same call).
			AnnotatedURL: controlAnnotatedURL(one.Control.ID, one.Reading.CopyNumber),
		})
	}

	if err := view.RenderStudent(w, page); err != nil {
		s.Log.Error("rendering a student", "student", studentID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
	}
}
