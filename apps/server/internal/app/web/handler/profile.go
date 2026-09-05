package handler

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/canvas"
	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// The profile screen's routes. English paths, Spanish page — the rule
// #150 set with /login and #151 restated (professors.go §Routes).
const (
	ProfilePath             = "/profile"
	ProfileCanvasTokenPath  = "/profile/canvas-token"
	ProfileCanvasForgetPath = "/profile/canvas-token/forget"
	ProfileAddCoursePath    = "/profile/courses"
)

// Profile holds the professor's own account screen: today, the Canvas
// token. Same shape as Professors — several handlers over shared
// dependencies, constructed once, refused when the set is incomplete so a
// wiring mistake is a panic at boot rather than a nil dereference inside a
// request (backend-code-style.md §Errors).
type Profile struct {
	Canvas *canvas.Service
	// Roster is the course picker's policy (issue #271 S5): which Canvas
	// courses this professor has, which are already added, and adding one.
	Roster    *roster.Service
	PublicURL string
	Log       *slog.Logger

	// secureCookie is DERIVED from PublicURL by NewProfile, never passed in
	// — same reasoning as Professors.secureCookie: false is a legal value,
	// so a forgotten flag would ship the flash without Secure over https
	// and no constructor check could see it.
	secureCookie bool
}

// NewProfile returns the handlers.
func NewProfile(deps Profile) *Profile {
	switch {
	case deps.Canvas == nil:
		panic("handler.NewProfile: no Canvas service")
	case deps.Roster == nil:
		panic("handler.NewProfile: no roster service")
	case deps.PublicURL == "":
		panic("handler.NewProfile: no public URL — the flash cookie's Secure attribute is derived from it")
	case deps.Log == nil:
		panic("handler.NewProfile: no logger")
	}
	deps.secureCookie = config.SecureFor(deps.PublicURL)
	return &deps
}

// Show renders the profile page.
func (p *Profile) Show(w http.ResponseWriter, r *http.Request) {
	p.render(w, r, http.StatusOK, nil)
}

// SaveCanvasToken verifies the pasted token against Canvas and stores it
// sealed. It is the same route for the first token and for a replacement:
// the store upserts, so "Guardar" and "Reemplazar" are one handler.
//
// Nothing here logs the submitted value, and nothing puts it in an error.
// A log line is the one place a credential leaks without anybody attacking
// anything.
func (p *Profile) SaveCanvasToken(w http.ResponseWriter, r *http.Request) {
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		// Unreachable behind RequireProfessor; a 403 rather than a panic is
		// what §Errors asks of a request path.
		middleware.WriteError(w, r, http.StatusForbidden, "Tu sesión no está activa.")
		return
	}

	if err := r.ParseForm(); err != nil {
		p.render(w, r, http.StatusUnprocessableEntity, map[string]string{
			"token": "No se pudo leer el formulario. Vuelve a intentarlo.",
		})
		return
	}

	// NOT trimmed: a Canvas token is opaque, and normalising it here would
	// turn a working paste into a rejection nobody could explain
	// (canvas.Service.SaveToken carries the same rule and its own test).
	err := p.Canvas.SaveToken(r.Context(), professor.ID, r.PostForm.Get("token"))
	switch {
	case err == nil:
		flash.Set(w, p.secureCookie, "Token de Canvas guardado.")
		http.Redirect(w, r, ProfilePath, http.StatusSeeOther)
		return

	case errors.Is(err, canvas.ErrTokenRejected):
		// A field error, not a 500: the professor fixes this by pasting
		// another token, and the form is where they do it.
		p.render(w, r, http.StatusUnprocessableEntity, map[string]string{
			"token": "Canvas rechazó este token. Revisa que lo hayas copiado " +
				"completo y que no lo hayas revocado.",
		})
		return

	case errors.Is(err, canvas.ErrUnavailable):
		// Nothing was stored and nothing is known about the token, so the
		// message must not suggest the token is wrong.
		p.Log.Warn("verifying a Canvas token", "professor", professor.ID, "error", err)
		p.render(w, r, http.StatusUnprocessableEntity, map[string]string{
			"token": "No se pudo contactar a Canvas para verificar el token. " +
				"No se guardó nada; inténtalo de nuevo en un momento.",
		})
		return

	case errors.Is(err, canvas.ErrNotConfigured):
		// The form should not have been rendered at all in this state. It
		// can still be reached by a hand-typed POST, and the page's own
		// explanation is the honest answer.
		p.render(w, r, http.StatusUnprocessableEntity, nil)
		return
	}

	p.Log.Error("storing a Canvas token", "professor", professor.ID, "error", err)
	middleware.WriteError(w, r, http.StatusInternalServerError,
		"Algo se rompió al guardar el token. Vuelve a intentarlo en unos segundos.")
}

// ForgetCanvasToken removes the stored token. Idempotent all the way down,
// so a double click says the same thing twice rather than failing the second
// time.
func (p *Profile) ForgetCanvasToken(w http.ResponseWriter, r *http.Request) {
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		middleware.WriteError(w, r, http.StatusForbidden, "Tu sesión no está activa.")
		return
	}

	if err := p.Canvas.Forget(r.Context(), professor.ID); err != nil && !errors.Is(err, canvas.ErrNotConfigured) {
		p.Log.Error("forgetting a Canvas token", "professor", professor.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió al eliminar el token. Vuelve a intentarlo en unos segundos.")
		return
	}

	flash.Set(w, p.secureCookie, "Token de Canvas eliminado.")
	http.Redirect(w, r, ProfilePath, http.StatusSeeOther)
}

// render builds the page from the current state and writes it.
//
// Connected is re-read on every render rather than carried through the
// request, so the page after a save reflects what is actually stored rather
// than what the handler believes it stored.
//
// The course list is fetched only on a 200. Every refusal re-render already
// spent one Canvas round trip on Verify, and a second one for a list the
// professor did not ask for doubled the wait on a rejected paste (#271
// review, PER-3). It is DERIVED from the status rather than passed in: an
// unlabelled `false` at four call sites carried no information the function
// did not already have (ARQ-12).
func (p *Profile) render(w http.ResponseWriter, r *http.Request, status int, fieldErrors map[string]string) {
	page := view.ProfilePage{
		Page:              middleware.PageFor(r, "Mi perfil"),
		SecretsConfigured: p.Canvas.Configured(),
		Action:            ProfileCanvasTokenPath,
		ForgetAction:      ProfileCanvasForgetPath,
		AddCourseAction:   ProfileAddCoursePath,
		Errors:            fieldErrors,
	}
	if professor, ok := middleware.ProfessorFrom(r.Context()); ok {
		page.Email = professor.Email
		page.Name = professor.Name

		connected, err := p.Canvas.Connected(r.Context(), professor.ID)
		switch {
		case err == nil:
			page.Connected = connected
		default:
			// A stored row that will not decrypt lands here — a rotated
			// master key, or a backup restored under a new one. This used to
			// be a 500, which made ADR-0068's own rotation mitigation
			// ("re-pasting every stored token") unreachable: /profile is the
			// ONLY page carrying the Reemplazar form and the Eliminar button,
			// so the professor could neither replace the token nor forget it
			// without a hand-crafted POST or sqlite3 on the host (#271
			// review, SEC-1).
			//
			// So the page renders, with both forms, and says what is wrong.
			// Connected is true because that is the branch holding them.
			// The log line stays: the operator is who fixes the cause.
			p.Log.Error("reading the Canvas connection state", "professor", professor.ID, "error", err)
			page.Connected = true
			page.TokenNotice = "El token guardado ya no se puede descifrar: la llave del servidor " +
				"cambió. Pega uno nuevo para reemplazarlo, o elimínalo."
		}

		// Not on the refusal re-renders, and not when the stored token is
		// unreadable. Canvas is a network round trip (~250 ms measured), and
		// on those paths its answer is either stale by definition or
		// impossible to fetch — the professor is on the page to fix the
		// token, not to read a course list (#271 review, PER-3).
		if page.Connected && status == http.StatusOK && page.TokenNotice == "" {
			page.Courses, page.CoursesNotice = p.coursesFor(r, professor.ID)
		}
	}

	if err := view.RenderProfile(w, status, page); err != nil {
		p.Log.Error("rendering the profile page", "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
	}
}

// coursesFor fetches the picker's rows, returning a Spanish notice instead
// of an error when Canvas cannot answer.
//
// A failure here does NOT fail the page. The token section above it is the
// professor's way out of most of these states — paste a new token, or wait
// for Canvas — and a 500 would take that away exactly when they need it.
// The notice names which of the three happened, because the fix differs.
func (p *Profile) coursesFor(r *http.Request, userID int64) (roster.CourseChoices, string) {
	choices, err := p.Roster.Choices(r.Context(), userID)
	switch {
	case err == nil:
		return choices, ""
	case errors.Is(err, canvas.ErrTokenRejected):
		// The token was good when it was stored and is not now: revoked in
		// Canvas, or expired. Nothing is wrong with this server.
		return roster.CourseChoices{}, "Canvas ya no acepta tu token: pudo haber caducado " +
			"o lo revocaste. Pega uno nuevo para volver a ver tus cursos."
	case errors.Is(err, canvas.ErrUnavailable):
		return roster.CourseChoices{}, "No se pudo contactar a Canvas para leer tus cursos. " +
			"Tu token sigue guardado; vuelve a cargar la página en un momento."
	case errors.Is(err, canvas.ErrNoToken), errors.Is(err, canvas.ErrNotConfigured):
		// Reachable only in a race: Connected said yes a moment ago and the
		// token went away between the two reads. The empty notice lets the
		// page render its own "connect Canvas" branch on the next load.
		return roster.CourseChoices{}, ""
	}

	p.Log.Error("listing the professor's Canvas courses", "professor", userID, "error", err)
	return roster.CourseChoices{}, "No se pudieron leer tus cursos de Canvas."
}

// AddCourse creates the `course` row for the Canvas course the professor
// picked.
//
// The form posts ONLY the Canvas id. Every other field is looked up in the
// professor's own Canvas listing by roster.Service.AddCourse — a hidden
// field carrying the name or the code would let a hand-typed request invent
// a course, or name one course while carrying another's id and then import
// somebody else's roster.
func (p *Profile) AddCourse(w http.ResponseWriter, r *http.Request) {
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		middleware.WriteError(w, r, http.StatusForbidden, "Tu sesión no está activa.")
		return
	}
	if err := r.ParseForm(); err != nil {
		middleware.WriteError(w, r, http.StatusBadRequest, "No se pudo leer el formulario.")
		return
	}

	course, err := p.Roster.AddCourse(r.Context(), professor.ID, r.PostForm.Get("canvas_course_id"))
	switch {
	case err == nil:
		// Straight to the course, which is where the professor goes next:
		// the roster is empty there and "Cargar desde Canvas" is the whole
		// page.
		flash.Set(w, p.secureCookie, "Curso "+course.Code+" agregado.")
		http.Redirect(w, r, CoursePathFor(course.ID), http.StatusSeeOther)
		return

	case errors.Is(err, roster.ErrAlreadyAdded):
		// Two clicks on the same button, or two tabs. Idempotent from the
		// professor's side: say so and carry on rather than showing a
		// failure for something that is already true.
		flash.Set(w, p.secureCookie, "Ese curso ya estaba agregado.")
	case errors.Is(err, roster.ErrNotInCanvas):
		flash.Set(w, p.secureCookie, "Canvas no lista ese curso para tu cuenta.")
	case errors.Is(err, canvas.ErrTokenRejected):
		flash.Set(w, p.secureCookie, "Canvas ya no acepta tu token. Pega uno nuevo.")
	case errors.Is(err, canvas.ErrUnavailable):
		flash.Set(w, p.secureCookie, "No se pudo contactar a Canvas. No se agregó nada.")
	case errors.Is(err, canvas.ErrNoToken), errors.Is(err, canvas.ErrNotConfigured):
		flash.Set(w, p.secureCookie, "La integración con Canvas no está configurada.")
	default:
		p.Log.Error("adding a Canvas course", "professor", professor.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió al agregar el curso. Vuelve a intentarlo en unos segundos.")
		return
	}
	http.Redirect(w, r, ProfilePath, http.StatusSeeOther)
}
