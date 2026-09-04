package handler

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/canvas"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// The profile screen's routes. English paths, Spanish page — the rule
// #150 set with /login and #151 restated (professors.go §Routes).
const (
	ProfilePath             = "/profile"
	ProfileCanvasTokenPath  = "/profile/canvas-token"
	ProfileCanvasForgetPath = "/profile/canvas-token/forget"
)

// Profile holds the professor's own account screen: today, the Canvas
// token. Same shape as Professors — several handlers over shared
// dependencies, constructed once, refused when the set is incomplete so a
// wiring mistake is a panic at boot rather than a nil dereference inside a
// request (backend-code-style.md §Errors).
type Profile struct {
	Canvas    *canvas.Service
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
func (p *Profile) render(w http.ResponseWriter, r *http.Request, status int, fieldErrors map[string]string) {
	page := view.ProfilePage{
		Page:              middleware.PageFor(r, "Mi perfil"),
		SecretsConfigured: p.Canvas.Configured(),
		Action:            ProfileCanvasTokenPath,
		ForgetAction:      ProfileCanvasForgetPath,
		Errors:            fieldErrors,
	}
	if professor, ok := middleware.ProfessorFrom(r.Context()); ok {
		page.Email = professor.Email
		page.Name = professor.Name

		connected, err := p.Canvas.Connected(r.Context(), professor.ID)
		if err != nil {
			// A stored row that will not decrypt lands here. Rendering the
			// empty form would invite the professor to paste a token
			// forever while the real problem is the master key, so this is
			// a 500 with a line in the log naming it.
			p.Log.Error("reading the Canvas connection state", "professor", professor.ID, "error", err)
			middleware.WriteError(w, r, http.StatusInternalServerError,
				"No se pudo leer el estado de la integración con Canvas.")
			return
		}
		page.Connected = connected
	}

	if err := view.RenderProfile(w, status, page); err != nil {
		p.Log.Error("rendering the profile page", "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
	}
}
