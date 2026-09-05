package handler_test

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/canvas"
	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
)

// The Canvas import (issue #271 S6), against the real database and the real
// upsert. The Canvas end is the stub; the real UDP instance is
// CANVAS-CHECK.md's job.

// importPost drives POST /courses/{id}/import-canvas with the path value
// bound the way the mux binds it.
func (f *profileFixture) importPost(t *testing.T, session string, courseID int64) *httptest.ResponseRecorder {
	t.Helper()

	path := handler.CoursePathFor(courseID) + "/import-canvas"
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(""))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: middleware.SessionCookieName(true), Value: session})
	// The mux binds {id} in production; a direct handler call has to do it
	// here or every parameterised route renders a 404.
	req.SetPathValue("id", strconv.FormatInt(courseID, 10))

	rec := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(http.HandlerFunc(f.coursesHandler.ImportCanvas))).
		ServeHTTP(rec, req)
	return rec
}

// flashOf decodes the one-shot flash cookie the response set. Empty when
// there is none.
func flashOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()

	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name != flash.CookieName || cookie.Value == "" {
			continue
		}
		decoded, err := base64.URLEncoding.DecodeString(cookie.Value)
		if err != nil {
			t.Fatalf("decoding the flash cookie: %v", err)
		}
		return string(decoded)
	}
	return ""
}

// addCourse puts one Canvas course in the store and returns its Nalanda id.
func (f *profileFixture) addCourse(t *testing.T, session, canvasCourseID string) int64 {
	t.Helper()

	if rec := f.post(t, session, handler.ProfileAddCoursePath, f.handler.AddCourse,
		url.Values{"canvas_course_id": {canvasCourseID}}); rec.Code != http.StatusSeeOther {
		t.Fatalf("adding the course: status = %d, want 303", rec.Code)
	}
	courses, err := f.courses.ListCourses(context.Background())
	if err != nil {
		t.Fatalf("ListCourses: %v", err)
	}
	for _, c := range courses {
		if c.CanvasCourseID == canvasCourseID {
			return c.ID
		}
	}
	t.Fatalf("the course %s was not stored", canvasCourseID)
	return 0
}

func aCanvasStudent(canvasUserID, rut, dv, lastName string) canvas.Student {
	return canvas.Student{
		FirstName:          "NOMBRE",
		LastName:           lastName,
		Email:              "x@mail.udp.cl",
		RUT:                rut,
		RUTDV:              dv,
		CanvasUserID:       canvasUserID,
		CanvasEnrollmentID: "e" + canvasUserID,
	}
}

func TestImportingARosterStoresThePeopleAndSaysHowMany(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	f.api.students = []canvas.Student{
		aCanvasStudent("900001", "11222333", "5", "PEREZ SOTO"),
		aCanvasStudent("900002", "11222444", "K", "MUÑOZ ÁVILA"),
	}

	rec := f.importPost(t, session, courseID)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", rec.Code)
	}
	// The Canvas course id asked about is the STORED course's, never one
	// the request could choose.
	if f.api.seenRosterCourse != "44779" {
		t.Errorf("Canvas was asked about %q, want the stored course's Canvas id", f.api.seenRosterCourse)
	}

	enrollments, err := f.courses.ListEnrollments(context.Background(), courseID)
	if err != nil {
		t.Fatalf("ListEnrollments: %v", err)
	}
	if len(enrollments) != 2 {
		t.Fatalf("got %d enrolments, want 2", len(enrollments))
	}
	if !strings.Contains(flashOf(t, rec), "2 estudiantes") {
		t.Errorf("the flash does not report the count: %q", flashOf(t, rec))
	}
}

// The count that looks like success and is not: students Canvas has no RUT
// for import fine and will match no control.
func TestTheImportFlashWarnsAboutStudentsWithNoRut(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	f.api.students = []canvas.Student{
		aCanvasStudent("900001", "11222333", "5", "PEREZ SOTO"),
		aCanvasStudent("99999", "", "", "EXTRANJERA"),
	}

	message := flashOf(t, f.importPost(t, session, courseID))
	if !strings.Contains(message, "1 sin RUT") {
		t.Errorf("the flash does not warn about the RUT-less student: %q", message)
	}
	if !strings.Contains(message, "\n") {
		t.Errorf("the warning is not its own line, so the layout renders it as one sentence: %q", message)
	}
}

// Canvas failing imports nothing. The dangerous version of this bug is
// silent: an empty roster applied on an outage would withdraw the whole
// class.
func TestAnUnreachableCanvasImportsNothingAndWithdrawsNobody(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	f.api.students = []canvas.Student{aCanvasStudent("900001", "11222333", "5", "PEREZ SOTO")}
	if rec := f.importPost(t, session, courseID); rec.Code != http.StatusSeeOther {
		t.Fatalf("the first import failed: %d", rec.Code)
	}

	f.api.err = canvas.ErrUnavailable
	message := flashOf(t, f.importPost(t, session, courseID))
	if !strings.Contains(message, "No se pudo contactar a Canvas") {
		t.Errorf("the flash does not name the outage: %q", message)
	}

	enrollments, err := f.courses.ListEnrollments(context.Background(), courseID)
	if err != nil {
		t.Fatalf("ListEnrollments: %v", err)
	}
	if len(enrollments) != 1 || enrollments[0].State != roster.StateEnrolled {
		t.Errorf("the roster was disturbed by a failed import: %+v", enrollments)
	}
}

func TestImportingIntoACourseThatDoesNotExistIs404(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)

	if rec := f.importPost(t, session, 4242); rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// A second import is the "Reimportar" button. It must not duplicate anyone.
func TestReimportingDoesNotDuplicateTheClass(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	f.api.students = []canvas.Student{
		aCanvasStudent("900001", "11222333", "5", "PEREZ SOTO"),
		aCanvasStudent("900002", "11222444", "K", "MUÑOZ ÁVILA"),
	}
	for i := range 2 {
		if rec := f.importPost(t, session, courseID); rec.Code != http.StatusSeeOther {
			t.Fatalf("import %d: status = %d", i+1, rec.Code)
		}
	}

	enrollments, err := f.courses.ListEnrollments(context.Background(), courseID)
	if err != nil {
		t.Fatalf("ListEnrollments: %v", err)
	}
	if len(enrollments) != 2 {
		t.Errorf("two imports produced %d enrolments, want 2", len(enrollments))
	}
}
