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

// --- The course pages (S7) -----------------------------------------------

func (f *profileFixture) getCourse(t *testing.T, session string, courseID int64) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, handler.CoursePathFor(courseID), nil)
	req.AddCookie(&http.Cookie{Name: middleware.SessionCookieName(true), Value: session})
	req.SetPathValue("id", strconv.FormatInt(courseID, 10))

	rec := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(http.HandlerFunc(f.coursesHandler.Show))).
		ServeHTTP(rec, req)
	return rec
}

func (f *profileFixture) getCourses(t *testing.T, session string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, handler.CoursesPath, nil)
	req.AddCookie(&http.Cookie{Name: middleware.SessionCookieName(true), Value: session})

	rec := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(http.HandlerFunc(f.coursesHandler.List))).
		ServeHTTP(rec, req)
	return rec
}

// The empty state IS the import affordance: a course with no roster has
// nothing else worth showing, so the button is the page.
func TestACourseWithNoRosterOffersTheImportButton(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	rec := f.getCourse(t, session, courseID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Cargar desde Canvas") {
		t.Errorf("the empty course does not offer the import:\n%s", body)
	}
	if strings.Contains(body, "Reimportar") {
		t.Error("a course with no roster offers Reimportar")
	}
	if !strings.Contains(body, "csrf_token") {
		t.Error("the import form carries no CSRF token; the router's guard would refuse the POST")
	}
}

func TestAPopulatedCourseShowsTheRosterAndOffersAReimport(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	f.api.students = []canvas.Student{
		aCanvasStudent("900001", "11222333", "5", "PEREZ SOTO"),
		aCanvasStudent("900002", "11222444", "K", "MUÑOZ ÁVILA"),
	}
	f.importPost(t, session, courseID)

	body := f.getCourse(t, session, courseID).Body.String()
	for _, want := range []string{"PEREZ SOTO", "MUÑOZ ÁVILA", "2 inscritos", "Reimportar"} {
		if !strings.Contains(body, want) {
			t.Errorf("the course page does not carry %q:\n%s", want, body)
		}
	}
	// The RUT is written the way a Chilean reader expects it, verifier and
	// all — the whole reason rut_dv is stored (ADR-0069 §Decision 1).
	if !strings.Contains(body, "11.222.333-5") {
		t.Errorf("the RUT is not formatted:\n%s", body)
	}
	if !strings.Contains(body, "11.222.444-K") {
		t.Errorf("the K verifier is not rendered:\n%s", body)
	}
	if strings.Contains(body, "Cargar desde Canvas") {
		t.Error("a populated course still offers the first-import wording")
	}
}

// A student with no RUT is visible AS such: a dash in the column and a
// count on the page. The import flash says it once and is gone; this fact
// is not.
func TestAStudentWithNoRutIsVisibleOnTheCoursePage(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	f.api.students = []canvas.Student{
		aCanvasStudent("900001", "11222333", "5", "PEREZ SOTO"),
		aCanvasStudent("99999", "", "", "EXTRANJERA"),
	}
	f.importPost(t, session, courseID)

	body := f.getCourse(t, session, courseID).Body.String()
	if !strings.Contains(body, "1 sin RUT") {
		t.Errorf("the page does not count the RUT-less student:\n%s", body)
	}
	if !strings.Contains(body, "—") {
		t.Errorf("the empty RUT cell is blank rather than a dash:\n%s", body)
	}
}

// Withdrawn students stay on the page, marked. They are not deleted, so
// hiding them would make the roster disagree with the database.
func TestAWithdrawnStudentIsShownAsWithdrawn(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	f.api.students = []canvas.Student{
		aCanvasStudent("900001", "11222333", "5", "PEREZ SOTO"),
		aCanvasStudent("900002", "11222444", "K", "MUÑOZ ÁVILA"),
	}
	f.importPost(t, session, courseID)

	f.api.students = f.api.students[:1]
	f.importPost(t, session, courseID)

	body := f.getCourse(t, session, courseID).Body.String()
	if !strings.Contains(body, "Retirado") {
		t.Errorf("the withdrawn student is not marked:\n%s", body)
	}
	if !strings.Contains(body, "MUÑOZ ÁVILA") {
		t.Error("the withdrawn student disappeared from the page")
	}
	if !strings.Contains(body, "1 inscritos") {
		t.Errorf("the enrolled count includes the withdrawn student:\n%s", body)
	}
}

func TestTheCourseListDistinguishesNoRosterFromNoStudents(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	// Never imported.
	if body := f.getCourses(t, session).Body.String(); !strings.Contains(body, "sin lista") {
		t.Errorf("a course that was never imported does not say so:\n%s", body)
	}

	f.api.students = []canvas.Student{aCanvasStudent("900001", "11222333", "5", "PEREZ SOTO")}
	f.importPost(t, session, courseID)

	body := f.getCourses(t, session).Body.String()
	if !strings.Contains(body, "1 inscritos") {
		t.Errorf("the list does not report the count:\n%s", body)
	}
	if !strings.Contains(body, handler.CoursePathFor(courseID)) {
		t.Errorf("the list does not link to the course:\n%s", body)
	}
}

func TestACourseThatDoesNotExistIs404(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)

	if rec := f.getCourse(t, session, 4242); rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// The import lands on the course, not back on the profile: the roster it
// just wrote is what the professor wants to look at.
func TestTheImportRedirectsToTheCourse(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	rec := f.importPost(t, session, courseID)
	if got, want := rec.Header().Get("Location"), handler.CoursePathFor(courseID); got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
}

func TestFormatRUTGroupsFromTheRight(t *testing.T) {
	for _, c := range []struct {
		rut, dv, want string
	}{
		// The measured shape: eight digits.
		{"11222333", "5", "11.222.333-5"},
		{"11222444", "K", "11.222.444-K"},
		// A seven-digit RUT reaches the schema zero-padded, so this is what
		// a short one looks like once stored.
		{"09876543", "2", "09.876.543-2"},
		// Absent: the template renders a dash, not this.
		{"", "", ""},
		{"11222333", "", ""},
	} {
		if got := handler.FormatRUT(c.rut, c.dv); got != c.want {
			t.Errorf("FormatRUT(%q, %q) = %q, want %q", c.rut, c.dv, got, c.want)
		}
	}
}
