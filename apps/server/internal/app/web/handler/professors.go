package handler

import (
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
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// The professor CRUD's routes. Exported like LoginPath so the router, the
// tests and (eventually) links inside pages name them once.
//
// URL paths are in English: #150 shipped /login and /logout in English, and
// a Spanish path would be the only one on the server. What a reader sees
// stays Spanish (issue #151 §Routes).
const (
	ProfessorsPath      = "/professors"
	ProfessorsNewPath   = "/professors/new"
	ProfessorEditPath   = "/professors/{id}/edit"
	ProfessorUpdatePath = "/professors/{id}"
)

// Professors holds the CRUD's handlers. Same shape as Auth: several handlers
// sharing dependencies, constructed once, refused when the set is incomplete
// so a wiring mistake is a panic at boot rather than a nil dereference inside
// a request (backend-code-style.md §Errors).
type Professors struct {
	Users     auth.UserStore
	PublicURL string
	Log       *slog.Logger

	// secureCookie is DERIVED from PublicURL by NewProfessors, never passed
	// in — same reasoning as handler.Auth.secureCookie: false is a legal
	// value, so a forgotten flag would ship the flash without Secure over
	// https and no constructor check could see it.
	secureCookie bool
}

// NewProfessors returns the handlers.
func NewProfessors(deps Professors) *Professors {
	switch {
	case deps.Users == nil:
		panic("handler.NewProfessors: no user store")
	case deps.PublicURL == "":
		panic("handler.NewProfessors: no public URL — the flash cookie's Secure attribute is derived from it")
	case deps.Log == nil:
		panic("handler.NewProfessors: no logger")
	}
	deps.secureCookie = config.SecureFor(deps.PublicURL)
	return &deps
}

// Root redirects `/` to the list. There is no portada: /login already says
// "pronto habrá más", and leaving / unclaimed lets a later WP decide what an
// index means once there is more than one section to index (issue #151
// §Routes).
func (p *Professors) Root(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, ProfessorsPath, http.StatusSeeOther)
}

// List renders every professor with the columns the WP asks for. See
// spanishDate for why formatting lives in this file rather than in the
// template.
func (p *Professors) List(w http.ResponseWriter, r *http.Request) {
	users, err := p.Users.ListUsers(r.Context())
	if err != nil {
		p.Log.Error("listing professors", "error", err)
		p.renderInternalError(w, r)
		return
	}

	page := view.ProfessorsListPage{
		Page:       p.pageFromRequest(r, "Profesores"),
		Professors: toListedProfessors(users),
	}
	page.Flash = flash.Consume(w, r, p.secureCookie)

	if err := view.RenderProfessorsList(w, page); err != nil {
		p.Log.Error("rendering the professor list", "error", err)
	}
}

// toListedProfessors turns the domain values into a display type. Format
// decisions live here rather than in the template because a template with
// enough logic to format three columns is a template with enough logic to
// hide a bug in one of them: the assertion in
// TestListRendersEveryProfessorAndSpellsOutTheNeverSignedInCase is on the
// rendered string, but the case that populated the string is easier to reason
// about as Go.
func toListedProfessors(users []auth.User) []view.ListedProfessor {
	out := make([]view.ListedProfessor, 0, len(users))
	for _, u := range users {
		row := view.ListedProfessor{
			ID:        u.ID,
			Email:     u.Email,
			Name:      u.Name,
			IsActive:  u.IsActive,
			State:     stateWord(u.IsActive),
			CreatedAt: spanishDate(u.CreatedAt),
		}
		if u.LastLoginAt != nil {
			row.LastSignIn = spanishDate(*u.LastLoginAt)
		} else {
			// AC-3 tail: in words, not an epoch, when they never have.
			row.LastSignIn = "Nunca ha entrado"
		}
		out = append(out, row)
	}
	return out
}

func stateWord(active bool) string {
	if active {
		return "Activa"
	}
	return "Inactiva"
}

// spanishDate formats a time.Time as a Spanish short date. Kept minimal — day,
// abbreviated month, year and 24h clock — because a professor's list is not
// a place to invent a locale library, and Go's time package speaks English
// months only.
func spanishDate(t time.Time) string {
	return fmt.Sprintf("%d %s %d, %02d:%02d", t.Day(), spanishMonth[t.Month()], t.Year(), t.Hour(), t.Minute())
}

var spanishMonth = map[time.Month]string{
	time.January:   "ene",
	time.February:  "feb",
	time.March:     "mar",
	time.April:     "abr",
	time.May:       "may",
	time.June:      "jun",
	time.July:      "jul",
	time.August:    "ago",
	time.September: "sep",
	time.October:   "oct",
	time.November:  "nov",
	time.December:  "dic",
}

// pageFromRequest builds the shell's own fields (title, professor, csrf).
// Handlers call this so the shell is populated the same way from every
// screen.
func (p *Professors) pageFromRequest(r *http.Request, title string) view.Page {
	page := view.Page{Title: title}
	if professor, ok := middleware.ProfessorFrom(r.Context()); ok {
		page.Professor = &professor
		if session, ok := middleware.SessionFrom(r.Context()); ok {
			page.CSRFToken = session.CSRFToken
		}
	}
	return page
}

// New renders the empty create form (GET /professors/new). It is the WP's
// form convention in one page: the SAME template handles GET (empty),
// validation-failure re-render (values + errors) and — from S7 — the edit
// form. Values are always echoed back; errors are per-field.
func (p *Professors) New(w http.ResponseWriter, r *http.Request) {
	page := view.ProfessorsFormPage{
		Page:    p.pageFromRequest(r, "Añadir profesora"),
		Action:  ProfessorsPath,
		Submit:  "Añadir",
		Heading: "Añadir profesora",
	}
	if err := view.RenderProfessorsForm(w, http.StatusOK, page); err != nil {
		p.Log.Error("rendering the create form", "error", err)
	}
}

// Create handles POST /professors: validates, creates, flashes and redirects
// (POST/redirect/GET) on success; re-renders the form with the values and
// per-field errors on refusal (status 422).
//
// Duplicate emails are a KNOWN validation failure and must not 500. authstore
// wraps the SQLite UNIQUE constraint error as a plain string; the domain
// does not sort constraint violations from unavailable databases, and
// checking with a preflight SELECT would be a race window. The shape used
// here is exactly what backend-code-style.md §Errors §Adding a repository
// covers — try, catch a known-shape error, report Spanish.
func (p *Professors) Create(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		p.rerenderNewWithErrors(w, r, view.ProfessorFormValues{}, map[string]string{
			"": "No se pudo leer el formulario. Inténtalo de nuevo.",
		})
		return
	}

	values := view.ProfessorFormValues{
		Email: strings.TrimSpace(strings.ToLower(r.PostFormValue("email"))),
		Name:  strings.TrimSpace(r.PostFormValue("name")),
	}
	if errs := validateProfessorForm(values); len(errs) > 0 {
		p.rerenderNewWithErrors(w, r, values, errs)
		return
	}

	if _, err := p.Users.CreateUser(r.Context(), values.Email, values.Name); err != nil {
		if isDuplicateEmail(err) {
			p.rerenderNewWithErrors(w, r, values, map[string]string{
				"email": "Ya existe una profesora con ese correo.",
			})
			return
		}
		p.Log.Error("creating a professor", "error", err, "email", values.Email)
		p.renderInternalError(w, r)
		return
	}

	flash.Set(w, p.secureCookie, "Profesora añadida: "+values.Email+".")
	http.Redirect(w, r, ProfessorsPath, http.StatusSeeOther)
}

func (p *Professors) rerenderNewWithErrors(w http.ResponseWriter, r *http.Request, values view.ProfessorFormValues, errs map[string]string) {
	page := view.ProfessorsFormPage{
		Page:    p.pageFromRequest(r, "Añadir profesora"),
		Action:  ProfessorsPath,
		Submit:  "Añadir",
		Heading: "Añadir profesora",
		Values:  values,
		Errors:  errs,
	}
	if err := view.RenderProfessorsForm(w, http.StatusUnprocessableEntity, page); err != nil {
		p.Log.Error("rendering the create form after validation", "error", err)
	}
}

// validateProfessorForm is the WP's validation convention: return a
// field-keyed map — empty means valid, and every unhappy field carries its
// own Spanish message.
//
// The email check is deliberately minimal: an `@` and a `.` after it, both
// non-empty around, because Google is what really validates the address on
// the way in (the callback exchanges a verified id_token). Nothing here can
// rescue a professor from a mistyped address — that is the debt §Notes
// records and defers.
func validateProfessorForm(values view.ProfessorFormValues) map[string]string {
	errs := map[string]string{}
	if values.Email == "" {
		errs["email"] = "El correo es obligatorio."
	} else if !looksLikeEmail(values.Email) {
		errs["email"] = "El correo no tiene la forma esperada."
	}
	if values.Name == "" {
		errs["name"] = "El nombre es obligatorio."
	}
	return errs
}

func looksLikeEmail(s string) bool {
	at := strings.LastIndex(s, "@")
	if at <= 0 || at == len(s)-1 {
		return false
	}
	local, domain := s[:at], s[at+1:]
	if strings.IndexByte(domain, '.') <= 0 {
		return false
	}
	if strings.HasPrefix(local, ".") || strings.HasSuffix(local, ".") {
		return false
	}
	return true
}

// isDuplicateEmail reports whether the error came from the schema's UNIQUE
// constraint on users.email. Modernc's SQLite returns the message text
// unchanged, so this matches on the substring the driver uses — kept in one
// place so the query and the check about it live together.
func isDuplicateEmail(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE constraint failed: users.email") ||
		strings.Contains(msg, "constraint failed: UNIQUE") // driver-version-tolerant fallback
}

// Edit renders the edit form pre-filled with the professor's current name.
// The address is shown but readonly — see issue #151 §Non-goals for why
// editing an address is account transfer wearing a rename's clothes.
func (p *Professors) Edit(w http.ResponseWriter, r *http.Request) {
	target, ok := p.loadTarget(w, r)
	if !ok {
		return
	}

	page := view.ProfessorsFormPage{
		Page:          p.pageFromRequest(r, "Editar profesora"),
		Action:        professorPath(target.ID),
		Submit:        "Guardar",
		Heading:       "Editar profesora",
		EmailReadonly: true,
		Values: view.ProfessorFormValues{
			Email: target.Email,
			Name:  target.Name,
		},
	}
	if err := view.RenderProfessorsForm(w, http.StatusOK, page); err != nil {
		p.Log.Error("rendering the edit form", "error", err)
	}
}

// Update handles POST /professors/{id}: validates the NAME only (the address
// is not editable), writes, flashes and redirects.
//
// The professor's ID is read from the URL pattern, not from a hidden form
// field, so a client cannot rename a professor by posting somebody else's id
// with their own token. The row's existence is checked first: an unknown id
// is a 404 through the shell, whether the caller landed here by URL or by a
// stale form.
func (p *Professors) Update(w http.ResponseWriter, r *http.Request) {
	target, ok := p.loadTarget(w, r)
	if !ok {
		return
	}

	if err := r.ParseForm(); err != nil {
		p.rerenderEditWithErrors(w, r, target, view.ProfessorFormValues{Email: target.Email}, map[string]string{
			"": "No se pudo leer el formulario. Inténtalo de nuevo.",
		})
		return
	}
	name := strings.TrimSpace(r.PostFormValue("name"))

	if name == "" {
		p.rerenderEditWithErrors(w, r, target, view.ProfessorFormValues{Email: target.Email, Name: name}, map[string]string{
			"name": "El nombre es obligatorio.",
		})
		return
	}

	if _, err := p.Users.UpdateUser(r.Context(), target.ID, name); err != nil {
		p.Log.Error("updating a professor", "error", err, "professor", target.ID)
		p.renderInternalError(w, r)
		return
	}

	flash.Set(w, p.secureCookie, "Cambios guardados en "+target.Email+".")
	http.Redirect(w, r, ProfessorsPath, http.StatusSeeOther)
}

func (p *Professors) rerenderEditWithErrors(w http.ResponseWriter, r *http.Request, target auth.User, values view.ProfessorFormValues, errs map[string]string) {
	page := view.ProfessorsFormPage{
		Page:          p.pageFromRequest(r, "Editar profesora"),
		Action:        professorPath(target.ID),
		Submit:        "Guardar",
		Heading:       "Editar profesora",
		EmailReadonly: true,
		Values:        values,
		Errors:        errs,
	}
	if err := view.RenderProfessorsForm(w, http.StatusUnprocessableEntity, page); err != nil {
		p.Log.Error("rendering the edit form after validation", "error", err)
	}
}

// loadTarget parses the {id} out of the URL path pattern and reads the row.
// A non-numeric id or an unknown one is a 404 through the shell — same
// answer, since neither has a professor to write a message about.
func (p *Professors) loadTarget(w http.ResponseWriter, r *http.Request) (auth.User, bool) {
	id, ok := parseIDFromPath(r)
	if !ok {
		p.renderNotFoundShell(w, r)
		return auth.User{}, false
	}
	target, err := p.Users.UserByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, auth.ErrNotFound) {
			p.renderNotFoundShell(w, r)
			return auth.User{}, false
		}
		p.Log.Error("reading a professor", "error", err, "id", id)
		p.renderInternalError(w, r)
		return auth.User{}, false
	}
	return target, true
}

// parseIDFromPath reads {id} from the mux's registered pattern. Written
// against r.PathValue so the code moves with the pattern; a hand-rolled path
// split would silently accept /professors/123/anything.
func parseIDFromPath(r *http.Request) (int64, bool) {
	raw := r.PathValue("id")
	if raw == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// professorPath is the canonical URL for one professor's actions. Kept in
// one place so a change to the pattern moves everywhere it is written.
func professorPath(id int64) string {
	return fmt.Sprintf("%s/%d", ProfessorsPath, id)
}

// renderNotFoundShell writes a 404 through the shell without going through
// the router — same shape as router.renderNotFound but for the case where a
// handler has ALREADY matched a pattern and only then finds the target is
// absent (an unknown id).
func (p *Professors) renderNotFoundShell(w http.ResponseWriter, r *http.Request) {
	page := view.ErrorPage{
		Page:    p.pageFromRequest(r, "No se encuentra"),
		Status:  http.StatusNotFound,
		Message: "Esa profesora no existe.",
	}
	if err := view.RenderError(w, page); err != nil {
		http.Error(w, "404", http.StatusNotFound)
	}
}

// renderInternalError writes a 500 through the shell when the domain layer
// blows up on a read. Kept small: an operator reading logs has the error, the
// professor reading the page needs a way out.
func (p *Professors) renderInternalError(w http.ResponseWriter, r *http.Request) {
	page := view.ErrorPage{
		Page:    p.pageFromRequest(r, "Error del servidor"),
		Status:  http.StatusInternalServerError,
		Message: "Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.",
	}
	if err := view.RenderError(w, page); err != nil {
		http.Error(w, "500", http.StatusInternalServerError)
	}
}
