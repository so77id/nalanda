package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/canvas"
	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// The courses screens' routes. English paths, Spanish pages — the rule
// #150 set with /login and #151 restated (professors.go §Routes).
const (
	CoursesPath      = "/courses"
	CoursePath       = "/courses/{id}"
	CourseImportPath = "/courses/{id}/import-canvas"
)

// CoursePathFor builds the URL of one course. Exported so the templates and
// the redirects name the pattern once — `/courses/{id}` with the segment
// substituted, never a second `fmt.Sprintf` somewhere else.
func CoursePathFor(id int64) string {
	return CoursesPath + "/" + strconv.FormatInt(id, 10)
}

// Courses holds the course screens: the list, one course's roster, and the
// Canvas import. Same shape as Professors and Profile.
type Courses struct {
	Roster    *roster.Service
	PublicURL string
	Log       *slog.Logger

	// secureCookie is DERIVED from PublicURL by NewCourses, never passed in
	// — same reasoning as Professors.secureCookie.
	secureCookie bool
}

// NewCourses returns the handlers.
func NewCourses(deps Courses) *Courses {
	switch {
	case deps.Roster == nil:
		panic("handler.NewCourses: no roster service")
	case deps.PublicURL == "":
		panic("handler.NewCourses: no public URL — the flash cookie's Secure attribute is derived from it")
	case deps.Log == nil:
		panic("handler.NewCourses: no logger")
	}
	deps.secureCookie = config.SecureFor(deps.PublicURL)
	return &deps
}

// List renders every stored course.
func (c *Courses) List(w http.ResponseWriter, r *http.Request) {
	courses, err := c.Roster.CoursesWithCounts(r.Context())
	if err != nil {
		c.Log.Error("listing the courses", "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}

	page := view.CoursesListPage{Page: middleware.PageFor(r, "Cursos")}
	for _, course := range courses {
		page.Courses = append(page.Courses, view.ListedCourse{
			Code:     course.Course.Code,
			Name:     course.Course.Name,
			Term:     course.Course.Term,
			URL:      CoursePathFor(course.Course.ID),
			Enrolled: enrolledLabel(course),
		})
	}

	if err := view.RenderCoursesList(w, page); err != nil {
		c.Log.Error("rendering the course list", "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
	}
}

// enrolledLabel words the count for the list.
//
// "sin lista" rather than "0 inscritos" for a course nobody has imported
// yet: zero students and no roster at all are different situations — the
// first wants a look at Canvas, the second wants a click — and the number
// alone cannot say which one this is. That is why HasRoster is a separate
// field and not `Enrolled == 0`: a course whose whole class withdrew has a
// roster and zero enrolled, and must not read as never-imported.
func enrolledLabel(course roster.CourseWithCounts) string {
	if !course.HasRoster {
		return "sin lista"
	}
	return fmt.Sprintf("%d inscritos", course.Counts.Enrolled)
}

// Show renders one course and its roster.
func (c *Courses) Show(w http.ResponseWriter, r *http.Request) {
	courseID, ok := c.courseIDFrom(w, r)
	if !ok {
		return
	}

	course, enrollments, err := c.Roster.Enrollments(r.Context(), courseID)
	switch {
	case errors.Is(err, roster.ErrCourseNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Ese curso no existe.")
		return
	case err != nil:
		c.Log.Error("reading a course", "course", courseID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió al leer el curso. Vuelve a intentarlo en unos segundos.")
		return
	}

	page := view.CourseDetailPage{
		Page: middleware.PageFor(r, course.Code),
		Course: view.ListedCourse{
			Code: course.Code,
			Name: course.Name,
			Term: course.Term,
			URL:  CoursePathFor(course.ID),
		},
		ImportAction: CourseImportPathFor(course.ID),
	}
	for _, e := range enrollments {
		switch e.State {
		case roster.StateEnrolled:
			page.EnrolledCount++
		case roster.StateWithdrawn:
			page.WithdrawnCount++
		}
		// Scoped to the people still enrolled. A withdrawn student with no
		// RUT cannot be matched to a control, and does not need to be: they
		// are not sitting one. Counting them would put a warning on the page
		// that no action can clear (#271 review, COR-6).
		if e.State == roster.StateEnrolled && !e.Student.HasRUT() {
			page.WithoutRUTCount++
		}
		page.Enrollments = append(page.Enrollments, view.ListedEnrollment{
			FirstName: e.Student.FirstName,
			LastName:  e.Student.LastName,
			RUT:       FormatRUT(e.Student.RUT, e.Student.RUTDV),
			Email:     e.Student.Email,
			State:     enrollmentStateLabel(e.State),
		})
	}

	if err := view.RenderCourseDetail(w, page); err != nil {
		c.Log.Error("rendering a course", "course", courseID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
	}
}

// FormatRUT writes the stored pair the way a Chilean reader expects it:
// 11222333 + "5" becomes "11.222.333-5". An absent RUT stays empty, and the
// template renders a dash — a professor scanning the column has to SEE the
// gap rather than miss a blank cell.
//
// Exported because WP-2's screens and WP-3's emails will want the same
// spelling, and a second implementation would be a second answer to "how is
// a RUT written".
func FormatRUT(rut, dv string) string {
	if rut == "" || dv == "" {
		return ""
	}
	// Grouped from the RIGHT, which is what makes 9876543 read as
	// "9.876.543" rather than "987.654.3".
	var groups []string
	for end := len(rut); end > 0; end -= 3 {
		start := max(end-3, 0)
		groups = append([]string{rut[start:end]}, groups...)
	}
	return strings.Join(groups, ".") + "-" + dv
}

// enrollmentStateLabel is the Spanish word for a stored state. The page a
// professor reads is Spanish; the column is not (apps/server/CLAUDE.md
// §Language).
func enrollmentStateLabel(state string) string {
	if state == roster.StateWithdrawn {
		return "Retirado"
	}
	return "Inscrito"
}

// importDeadline bounds one roster import end to end.
//
// Twenty seconds, below httpserver's 30-second WriteTimeout, so the handler
// gives up while the professor's connection is still alive rather than
// committing into a socket the server has already abandoned.
const importDeadline = 20 * time.Second

// CourseImportPathFor builds one course's import URL.
func CourseImportPathFor(id int64) string {
	return CoursePathFor(id) + "/import-canvas"
}

// ImportCanvas fetches the course's roster from Canvas and applies it.
//
// Synchronous, unlike the four AMC operations that go through the job
// runner (ADR-0050). The reason that rule exists is the AMC worker: a
// LaTeX compile or a scan analysis takes minutes and would hold the HTTP
// goroutine open. A roster import is a handful of GraphQL round trips over
// a class of tens — the 29-enrolment course measured in S4 came back in one
// page — and the professor is standing in front of the button waiting to
// see the list. Making it async would add a job kind, a banner and a
// polling page to save a second.
//
// The bound is IMPOSED here, not inherited. An earlier revision of this
// comment claimed the client's own 15-second per-request timeout and its
// 100-page cap bounded the worst case; multiplied out that is 25 minutes,
// fifty times the server's own 30-second WriteTimeout (#271 review, PER-1 /
// SEC-6). And WriteTimeout does not rescue anything: a review probe showed
// it neither aborts the handler nor cancels r.Context() — the client gets an
// EOF while the handler runs on and the roster commits to a connection
// nobody is listening to.
//
// So the whole import carries one explicit deadline, below the write
// timeout, and the professor gets a flash instead of a dead page. Same shape
// as the upload window in scans.go. A timed-out import applies nothing (the
// store's transaction rolls back) and the retry is idempotent.
func (c *Courses) ImportCanvas(w http.ResponseWriter, r *http.Request) {
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		middleware.WriteError(w, r, http.StatusForbidden, "Tu sesión no está activa.")
		return
	}
	courseID, ok := c.courseIDFrom(w, r)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), importDeadline)
	defer cancel()

	result, err := c.Roster.Import(ctx, professor.ID, courseID)
	switch {
	case err == nil:
		flash.Set(w, c.secureCookie, importFlash(result))
	case errors.Is(err, roster.ErrCourseNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Ese curso no existe.")
		return
	case errors.Is(err, roster.ErrDuplicateRUT):
		// Nothing was applied — the store's transaction rolled back — and
		// the professor cannot fix this from here: two Canvas accounts
		// carry one RUT and Canvas is where that gets resolved.
		c.Log.Error("importing a roster", "course", courseID, "error", err)
		flash.Set(w, c.secureCookie,
			"No se importó nada: hay dos cuentas de Canvas con el mismo RUT en este curso. "+
				"Corrígelo en Canvas y vuelve a importar.")
	case errors.Is(err, canvas.ErrTokenRejected):
		flash.Set(w, c.secureCookie, "Canvas ya no acepta tu token. Pega uno nuevo en tu perfil.")
	case errors.Is(err, canvas.ErrUnavailable):
		flash.Set(w, c.secureCookie, "No se pudo contactar a Canvas. No se importó nada.")
	case errors.Is(err, canvas.ErrNoToken), errors.Is(err, canvas.ErrNotConfigured):
		flash.Set(w, c.secureCookie, "Primero configura tu token de Canvas en tu perfil.")
	case errors.Is(err, canvas.ErrCourseNotFound):
		flash.Set(w, c.secureCookie,
			"Canvas ya no reconoce ese curso. Puede que lo hayan borrado o que tu token ya no lo alcance.")
	default:
		c.Log.Error("importing a roster", "course", courseID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió al importar la lista. Vuelve a intentarlo en unos segundos.")
		return
	}

	// Back to the course, where the roster the import just wrote is what
	// the professor wants to look at.
	http.Redirect(w, r, CoursePathFor(courseID), http.StatusSeeOther)
}

// importFlash is the Spanish sentence describing what an import did.
//
// It reports the counts the professor can act on rather than a bare "listo".
// WithoutRUT is the one that earns its line: those students imported fine
// and will match no control, which is the outcome that looks like success
// and is not (ADR-0069 §Consequences).
func importFlash(r roster.ImportResult) string {
	line := fmt.Sprintf("Lista importada: %d estudiantes", r.Total())
	if r.Added > 0 && r.Updated > 0 {
		line += fmt.Sprintf(" (%d nuevos, %d actualizados)", r.Added, r.Updated)
	}
	if r.Withdrawn > 0 {
		line += fmt.Sprintf(". %d ya no están en el curso y quedaron marcados como retirados", r.Withdrawn)
	}
	line += "."
	if r.WithoutRUT > 0 {
		// A separate line: the layout renders a multi-line flash as a list
		// (§Flash), and this is a different kind of statement from the
		// counts above — something to look at, not something that happened.
		line += fmt.Sprintf("\nOjo: %d sin RUT en Canvas. No se van a poder emparejar con sus controles.",
			r.WithoutRUT)
	}
	return line
}

// courseIDFrom reads and validates the {id} path segment, writing the
// refusal itself when it is not usable.
func (c *Courses) courseIDFrom(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		// A 404 rather than a 400: from the professor's side a URL that
		// does not name a course is a page that is not there, and the
		// distinction between "malformed" and "absent" is one only the
		// server cares about.
		middleware.WriteError(w, r, http.StatusNotFound, "Ese curso no existe.")
		return 0, false
	}
	return id, true
}
