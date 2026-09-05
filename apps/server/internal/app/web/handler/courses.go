package handler

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
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
// The bound is real rather than assumed: the Canvas client carries a
// 15-second timeout per request and caps the pagination, so the worst case
// is bounded even if Canvas hangs.
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

	result, err := c.Roster.Import(r.Context(), professor.ID, courseID)
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

	// Back to the profile for now: /courses/{id} arrives with S7, and a 303
	// to it today would be a redirect to a 404.
	http.Redirect(w, r, ProfilePath, http.StatusSeeOther)
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
