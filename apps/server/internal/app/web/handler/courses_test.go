package handler_test

import (
	"context"
	"encoding/base64"
	"errors"
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
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
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
	return f.getCoursePage(t, session, courseID,
		handler.CoursePathFor(courseID), f.coursesHandler.Show)
}

// getStudents renders the roster page. Since issue #272 S6 the roster
// table lives here rather than on the course page — the #271 cases below
// that assert on names, RUTs and the import button follow it, because
// what they check is still true and only moved.
func (f *profileFixture) getStudents(t *testing.T, session string, courseID int64) *httptest.ResponseRecorder {
	t.Helper()
	return f.getCoursePage(t, session, courseID,
		handler.CourseStudentsPathFor(courseID), f.coursesHandler.Students)
}

func (f *profileFixture) getCoursePage(t *testing.T, session string, courseID int64, path string, h http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.AddCookie(&http.Cookie{Name: middleware.SessionCookieName(true), Value: session})
	req.SetPathValue("id", strconv.FormatInt(courseID, 10))

	rec := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(h)).ServeHTTP(rec, req)
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

	rec := f.getStudents(t, session, courseID)
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

	body := f.getStudents(t, session, courseID).Body.String()
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
func TestAStudentWithNoRutIsVisibleOnTheRosterPage(t *testing.T) {
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

	body := f.getStudents(t, session, courseID).Body.String()
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

	body := f.getStudents(t, session, courseID).Body.String()
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

// --- Review fixes (#271 review) ------------------------------------------

// SEC-1. A rotated master key — or a backup restored on a host with a
// regenerated .env — leaves a ciphertext that no longer decrypts. That used
// to make /profile a hard 500, and /profile is the ONLY page carrying the
// Reemplazar form and the Eliminar button: ADR-0068 §Consequences names
// "re-pasting every stored token" as the mitigation for a rotation, and the
// 500 made that mitigation unreachable without hand-crafting a POST or
// running sqlite3 on the host.
//
// The page must render, say what is wrong, and keep both ways out.
func TestAStoredTokenThatNoLongerDecryptsLeavesBothWaysOutOnScreen(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)

	// The operator rotates the key: same database, different master key.
	rotated := profileKey()
	rotated[0] ^= 0xff
	f.rekey(t, rotated)

	rec := f.get(t, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — a rotated key must not lock the professor out of the page", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "ya no se puede descifrar") {
		t.Errorf("the page does not say the stored token is unreadable:\n%s", body)
	}
	// Both ways out, which is the whole point.
	if !strings.Contains(body, handler.ProfileCanvasTokenPath) {
		t.Error("the Reemplazar form is gone; the professor cannot paste a new token")
	}
	if !strings.Contains(body, handler.ProfileCanvasForgetPath) {
		t.Error("the Eliminar form is gone; the professor cannot clear the unreadable token")
	}
	// And it does not pretend the integration is healthy.
	if strings.Contains(body, "Nalanda puede leer tus cursos") {
		t.Error("the page claims the integration works while the token cannot be read")
	}
}

// And the way out actually works: pasting a new token under the new key
// recovers the integration.
func TestPastingANewTokenRecoversFromARotatedKey(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)

	rotated := profileKey()
	rotated[0] ^= 0xff
	f.rekey(t, rotated)

	// The intermediate GET is asserted on purpose. Without it this case
	// passes with the old 500 restored — SaveCanvasToken's success path
	// redirects without ever rendering the failing branch, so the recovery
	// alone proves nothing about SEC-1 (#271 recheck, SEC-1b). The
	// professor has to REACH the form before they can use it.
	before := f.get(t, session)
	if before.Code != http.StatusOK {
		t.Fatalf("the page the professor must reach to re-paste answered %d", before.Code)
	}
	if !strings.Contains(before.Body.String(), "ya no se puede descifrar") {
		t.Fatal("the page does not say the stored token is unreadable")
	}

	if rec := f.post(t, session, handler.ProfileCanvasTokenPath, f.handler.SaveCanvasToken,
		url.Values{"token": {canvasToken}}); rec.Code != http.StatusSeeOther {
		t.Fatalf("re-pasting: status = %d, want 303", rec.Code)
	}

	body := f.get(t, session).Body.String()
	if !strings.Contains(body, "Token configurado") {
		t.Errorf("the integration did not recover after re-pasting:\n%s", body)
	}
	if strings.Contains(body, "ya no se puede descifrar") {
		t.Error("the page still reports the old unreadable token")
	}
}

// PER-3. A rejected paste already spent one Canvas round trip on Verify.
// The re-render used to spend a second one listing courses the professor
// did not ask for — doubling the wait on the one screen they are on
// precisely because something went wrong.
func TestARejectedTokenDoesNotAlsoFetchTheCourseList(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)

	f.api.courseCalls = 0
	f.api.err = canvas.ErrTokenRejected

	rec := f.post(t, session, handler.ProfileCanvasTokenPath, f.handler.SaveCanvasToken,
		url.Values{"token": {canvasToken}})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if f.api.courseCalls != 0 {
		t.Errorf("the refusal re-render made %d course listing call(s), want 0", f.api.courseCalls)
	}
	// The message the professor came for is still there.
	if !strings.Contains(rec.Body.String(), "Canvas rechazó este token") {
		t.Error("the refusal message is missing from the re-render")
	}
}

// COR-6. The list's "N inscritos" must count only the enrolled. Replacing
// the state filter with an unconditional count left the suite green,
// because the only fixture had nobody withdrawn.
func TestTheCourseListCountsOnlyTheEnrolled(t *testing.T) {
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

	// One drops.
	f.api.students = f.api.students[:1]
	f.importPost(t, session, courseID)

	body := f.getCourses(t, session).Body.String()
	if !strings.Contains(body, "1 inscritos") {
		t.Errorf("the list does not count only the enrolled:\n%s", body)
	}
	if strings.Contains(body, "2 inscritos") {
		t.Error("the list counts a withdrawn student as enrolled")
	}
	// And a course with a roster whose students ALL withdrew still reads as
	// having a roster — "sin lista" means nobody ever imported it.
	f.api.students = nil
	f.importPost(t, session, courseID)
	body = f.getCourses(t, session).Body.String()
	if !strings.Contains(body, "0 inscritos") {
		t.Errorf("a course whose class all withdrew does not read as 0 inscritos:\n%s", body)
	}
	if strings.Contains(body, "sin lista") {
		t.Error("a course that WAS imported reads as never imported")
	}
}

// COR-6's other half: the "sin RUT" warning is about the current class. A
// withdrawn student with no RUT is not sitting a control, and counting them
// would put a warning on the page that no action can clear.
func TestTheRutWarningCountsOnlyTheEnrolled(t *testing.T) {
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
	if body := f.getStudents(t, session, courseID).Body.String(); !strings.Contains(body, "1 sin RUT") {
		t.Fatalf("the warning is missing while the RUT-less student is enrolled:\n%s", body)
	}

	// The RUT-less student drops; the warning goes with them.
	f.api.students = f.api.students[:1]
	f.importPost(t, session, courseID)

	body := f.getStudents(t, session, courseID).Body.String()
	if strings.Contains(body, "sin RUT") {
		t.Errorf("the warning survives the student's withdrawal, so nothing can clear it:\n%s", body)
	}
	if !strings.Contains(body, "EXTRANJERA") {
		t.Error("the withdrawn student disappeared from the roster table")
	}
}

// --- Issue #272 S5: the retroactive pass, from the browser. ---

// fakeRematcher is the course screens' controls double. It records what
// it was asked and answers with fixed values.
//
// The pass itself is covered against a real reading store in
// internal/domain/controls; what is left for this level is the parse, the
// flash and the redirect. Named for the first thing it did (issue #272
// S5); S6 gave it the control list too.
type fakeRematcher struct {
	result   controls.RematchResult
	fail     error
	courses  []int64
	allCalls int
	// controlsForCourse is what the course page lists, and listFail is
	// how a case makes that read break (issue #272 S6).
	controlsForCourse []controls.Control
	listFail          error
}

func (m *fakeRematcher) ControlsForCourse(_ context.Context, _ int64) ([]controls.Control, error) {
	return m.controlsForCourse, m.listFail
}

func (m *fakeRematcher) RematchCourse(_ context.Context, courseID int64) (controls.RematchResult, error) {
	m.courses = append(m.courses, courseID)
	return m.result, m.fail
}

func (m *fakeRematcher) RematchAllCourses(context.Context) (controls.RematchResult, error) {
	m.allCalls++
	return m.result, m.fail
}

// The button reports what the pass did, in numbers the professor can act
// on, and comes back to the course.
func TestRematchReportsTheCountsAndReturnsToTheCourse(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")
	f.rematcher.result = controls.RematchResult{Controls: 2, Matched: 27, Unmatched: 3, Changed: 27}

	rec := f.rematchPost(t, session, courseID)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303; body:\n%s", rec.Code, rec.Body.String())
	}
	if loc := rec.Header().Get("Location"); loc != handler.CoursePathFor(courseID) {
		t.Errorf("Location = %q, want the course page", loc)
	}
	if len(f.rematcher.courses) != 1 || f.rematcher.courses[0] != courseID {
		t.Errorf("the rematcher was asked for %v, want course %d once", f.rematcher.courses, courseID)
	}

	msg := flashOf(t, rec)
	for _, want := range []string{"2 controles", "27 copias emparejadas", "3 copias sin alumno"} {
		if !strings.Contains(msg, want) {
			t.Errorf("flash %q does not carry %q", msg, want)
		}
	}
}

// A pass that changed nothing says so, rather than leaving the professor
// to guess whether the button worked.
//
// This is what a second press looks like, and it is the reading of
// "idempotent" a professor can actually perform.
func TestRematchSaysWhenNothingChanged(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")
	f.rematcher.result = controls.RematchResult{Controls: 1, Matched: 30, Changed: 0}

	msg := flashOf(t, f.rematchPost(t, session, courseID))
	if !strings.Contains(msg, "ninguna cambió") {
		t.Errorf("flash %q does not say that nothing changed", msg)
	}
}

// Zero counts stay out of the message.
//
// The professor is scanning for what needs attention; a line of zeroes is
// three things to read past to find the one that is not zero.
func TestRematchLeavesZeroCountsOutOfTheFlash(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")
	f.rematcher.result = controls.RematchResult{Controls: 1, Matched: 30, Changed: 30}

	msg := flashOf(t, f.rematchPost(t, session, courseID))
	for _, unwanted := range []string{"sin alumno", "sin curso asignado", "no se pudo consultar"} {
		if strings.Contains(msg, unwanted) {
			t.Errorf("flash %q carries %q for a count of zero", msg, unwanted)
		}
	}
}

// Controls with no course get their own line, because their fix is
// different from every other one: assign them a course.
func TestRematchNamesTheControlsThatHaveNoCourse(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")
	f.rematcher.result = controls.RematchResult{Controls: 1, Skipped: 2, Matched: 10, Changed: 10}

	msg := flashOf(t, f.rematchPost(t, session, courseID))
	if !strings.Contains(msg, "sin curso asignado") {
		t.Errorf("flash %q does not name the controls with no course", msg)
	}
}

// A failed pass is a 500 the professor can retry, not a flash claiming
// success.
func TestRematchSurfacesAFailure(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")
	f.rematcher.fail = errors.New("the database is gone")

	rec := f.rematchPost(t, session, courseID)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
	if flashOf(t, rec) != "" {
		t.Error("a failed pass set a flash; nothing happened worth reporting as done")
	}
}

// rematchPost drives POST /courses/{id}/rematch with the path value bound
// the way the mux binds it.
func (f *profileFixture) rematchPost(t *testing.T, session string, courseID int64) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, handler.CourseRematchPathFor(courseID), strings.NewReader(""))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: middleware.SessionCookieName(true), Value: session})
	req.SetPathValue("id", strconv.FormatInt(courseID, 10))

	rec := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(http.HandlerFunc(f.coursesHandler.Rematch))).
		ServeHTTP(rec, req)
	return rec
}

// --- Issue #272 S6: the course page's two sections. ---

// AC7: the course page carries both sections, the link to the roster, and
// both counts.
func TestTheCoursePageShowsItsControlsAndLinksToTheRoster(t *testing.T) {
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

	f.rematcher.controlsForCourse = []controls.Control{
		{ID: "CTRLUNO0000000000000000AA", Name: "Control 1", QuestionsPerCopy: 4, Copies: 30, State: controls.Graded},
		{ID: "CTRLDOS0000000000000000AA", Name: "Control 2", QuestionsPerCopy: 4, Copies: 30, State: controls.Generated},
	}

	body := f.getCourse(t, session, courseID).Body.String()

	for _, want := range []string{
		"Controles",              // the section
		"Control 1", "Control 2", // the list
		"/controls/CTRLUNO0000000000000000AA",   // each row links to its control
		"Alumnos",                               // the other section
		"2 inscritos",                           // the roster count
		handler.CourseStudentsPathFor(courseID), // the link to it
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the course page does not carry %q:\n%s", want, body)
		}
	}

	// The roster TABLE is not here any more — that is the point of the
	// split. A name on this page would mean it came back.
	if strings.Contains(body, "PEREZ SOTO") {
		t.Error("the roster table is still rendered on the course page; S6 moved it to /alumnos")
	}
}

// A course with no controls says so instead of rendering an empty table.
//
// It is the ordinary state of a course just added, not a problem, and the
// useful thing to show is the way to create the first one.
func TestACourseWithNoControlsSaysSoAndPointsAtNewControl(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	body := f.getCourse(t, session, courseID).Body.String()
	if !strings.Contains(body, "Todavía no hay ningún control") {
		t.Errorf("the empty state is missing:\n%s", body)
	}
	if !strings.Contains(body, "/controls/new") {
		t.Error("the empty state does not point at the create form")
	}
}

// The matrix link is absent until S9 builds the page behind it.
//
// A link to a 404 is worse than a link that arrives one slice later, and
// this case is what makes the S9 author notice they have to add it.
func TestTheCoursePageDoesNotLinkToAMatrixThatDoesNotExistYet(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")
	f.rematcher.controlsForCourse = []controls.Control{
		{ID: "CTRLUNO0000000000000000AA", Name: "Control 1", QuestionsPerCopy: 4, Copies: 30, State: controls.Graded},
	}

	body := f.getCourse(t, session, courseID).Body.String()
	if strings.Contains(body, "matriz") || strings.Contains(body, "Matriz") {
		t.Error("the course page links to the matrix, which S9 has not built yet")
	}
}

// The two pages agree on the counts.
//
// The course page's "2 inscritos" is a promise about what the roster page
// shows; a professor who clicks through to find a different number has
// been lied to by whichever one drifted. One tally function serves both,
// and this is what pins that.
func TestTheCourseAndRosterPagesAgreeOnTheCounts(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	f.api.students = []canvas.Student{
		aCanvasStudent("900001", "11222333", "5", "PEREZ SOTO"),
		aCanvasStudent("900002", "11222444", "K", "MUÑOZ ÁVILA"),
		aCanvasStudent("900003", "", "", "SIN RUT"),
	}
	f.importPost(t, session, courseID)

	course := f.getCourse(t, session, courseID).Body.String()
	roster := f.getStudents(t, session, courseID).Body.String()

	for _, want := range []string{"3 inscritos", "1 sin RUT"} {
		if !strings.Contains(course, want) {
			t.Errorf("the course page does not say %q:\n%s", want, course)
		}
		if !strings.Contains(roster, want) {
			t.Errorf("the roster page does not say %q:\n%s", want, roster)
		}
	}
}

// A failure to read the controls is a 500, not a course page rendered
// with an empty Controles section.
//
// The two look identical to a professor and mean opposite things: one is
// "you have no controls", the other is "nobody could ask". Rendering the
// first for the second would send them to create a control that already
// exists.
func TestACoursePageWhoseControlsCannotBeReadIs500(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")
	f.rematcher.listFail = errors.New("the database is gone")

	rec := f.getCourse(t, session, courseID)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "Todavía no hay ningún control") {
		t.Error("a failed read rendered as 'you have no controls'")
	}
}

// The roster page is reachable and carries its way back.
func TestTheRosterPageNamesTheCourseAndLinksBack(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	rec := f.getStudents(t, session, courseID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), handler.CoursePathFor(courseID)) {
		t.Error("the roster page has no way back to its course")
	}
}

// A roster page for a course that does not exist is a 404, like the
// course page it hangs off.
func TestARosterPageForACourseThatDoesNotExistIs404(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)

	if rec := f.getStudents(t, session, 4242); rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}
