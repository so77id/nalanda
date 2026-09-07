package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/gmail"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
)

// The publication routes (issue #273). On the PROFESSOR'S surface, behind
// the session gate and CSRF, beside POST /controls/{id}/close.
//
// The issue's design wrote them under /api/. They are not there, and the
// reason is not stylistic: internal/app/api is anonymous by construction
// (§C12, pinned in both directions by cmd/server/main_test.go), so a
// publication endpoint on that surface would let any unauthenticated caller
// on the internet email an entire class. The issue's own Notes already said
// "backend + backoffice only".
const (
	ControlPublishPath  = "/controls/{id}/publish"
	ControlTestSendPath = "/controls/{id}/test-send"
)

// controlPublishURL and controlTestSendURL build the two POST targets, so
// the template and the redirects name each pattern once.
func controlPublishURL(id string) string  { return ControlsPath + "/" + id + "/publish" }
func controlTestSendURL(id string) string { return ControlsPath + "/" + id + "/test-send" }

// GmailConnection is the slice of the Gmail domain these screens need: can
// the professor at the keyboard send at all.
//
// A narrow port rather than a *gmail.Service field, the RosterReader
// reasoning: the control screens ask one question, and injecting the
// service would drag an OAuth client and a secret store into every controls
// test to render a disabled button.
type GmailConnection interface {
	Connection(ctx context.Context, professorID int64) (gmail.Connection, error)
}

var _ GmailConnection = (*gmail.Service)(nil)

// Publish stamps the control and enqueues the sending job.
//
// The gates run HERE as well as in the domain, and the duplication is
// deliberate rather than sloppy. A gate in the job answers minutes later
// through a banner; a gate here answers now, on the page with the button,
// where the professor can act on it. The domain's copy is what protects
// against a hand-typed POST and against a state that changed between the
// two — it is the authority, this is the courtesy.
func (h *Controls) Publish(w http.ResponseWriter, r *http.Request) {
	id, professor, ok := h.publishPreamble(w, r)
	if !ok {
		return
	}
	if err := r.ParseForm(); err != nil {
		middleware.WriteError(w, r, http.StatusBadRequest,
			"No se pudo leer el formulario. Inténtalo de nuevo.")
		return
	}

	mode := controls.PublishMode(strings.TrimSpace(r.PostFormValue("mode")))
	if !controls.ValidPublishMode(mode) {
		middleware.WriteError(w, r, http.StatusUnprocessableEntity,
			"Esa forma de envío no existe. Vuelve al control y elige una de la lista.")
		return
	}

	control, ok := h.publishableControl(w, r, id)
	if !ok {
		return
	}
	if control.PublishedAt != nil {
		// 409, not 422: the request is well-formed and the professor is
		// allowed to make it — the resource is simply already in the state
		// they asked for, and publication is one-way in v1.
		middleware.WriteError(w, r, http.StatusConflict,
			"Este control ya fue publicado. La publicación es de una sola vez.")
		return
	}
	if !h.canSend(w, r, professor.ID) {
		return
	}

	payload, err := json.Marshal(controls.PublishPayload{
		ProfessorID: professor.ID,
		Mode:        string(mode),
	})
	if err != nil {
		h.Log.Error("publish: encode the payload", "control", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió al preparar el envío. Vuelve a intentarlo.")
		return
	}
	if _, err := h.Runner.Submit(r.Context(), id, jobs.KindPublish, payload); err != nil {
		h.Log.Error("publish: submit the job", "control", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"No se pudo encolar el envío. Vuelve a intentarlo en unos segundos.")
		return
	}

	// Deliberately says "empezó" rather than "listo". The job runs after
	// this redirect, and a flash claiming the class had been written to
	// would be a claim this handler cannot make — the banner is what
	// reports the outcome.
	flash.Set(w, h.secureCookie,
		"Empezó el envío de las correcciones. El aviso de arriba dirá cuándo termina.")
	http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
}

// publishPreamble resolves the two things both routes need.
func (h *Controls) publishPreamble(w http.ResponseWriter, r *http.Request) (string, auth.User, bool) {
	id := r.PathValue("id")
	if !isValidControlID(id) {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return "", auth.User{}, false
	}
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		// Unreachable behind RequireProfessor; a 403 rather than a panic is
		// what §Errors asks of a request path.
		middleware.WriteError(w, r, http.StatusForbidden, "Tu sesión no está activa.")
		return "", auth.User{}, false
	}
	return id, professor, true
}

// publishableControl loads the control and refuses the two states from
// which nothing can be sent.
func (h *Controls) publishableControl(w http.ResponseWriter, r *http.Request, id string) (controls.Control, bool) {
	control, err := h.Service.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, controls.ErrControlNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
			return controls.Control{}, false
		}
		h.Log.Error("publish: reading the control", "control", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return controls.Control{}, false
	}
	switch {
	case control.State != controls.Graded:
		middleware.WriteError(w, r, http.StatusUnprocessableEntity,
			"Todavía no se puede enviar: cierra la corrección primero.")
		return controls.Control{}, false
	case control.CourseID == nil:
		middleware.WriteError(w, r, http.StatusUnprocessableEntity,
			"Este control no está asignado a un curso, así que no hay a quién enviarle nada. "+
				"Asígnale uno desde esta misma página.")
		return controls.Control{}, false
	}
	return control, true
}

// canSend refuses a professor with no connected account, here rather than
// three minutes later in a banner.
//
// A read failure is NOT treated as "cannot send": the credential may be
// perfectly good and the lookup merely blinked, and refusing on it would
// block a publication over a hiccup. The domain checks again with the
// authority, so the worst case of letting this through is the job
// reporting the same refusal in the place it would have reported it
// anyway.
func (h *Controls) canSend(w http.ResponseWriter, r *http.Request, professorID int64) bool {
	connection, err := h.Gmail.Connection(r.Context(), professorID)
	if err != nil {
		h.Log.Warn("publish: reading the Gmail connection", "professor", professorID, "error", err)
		return true
	}
	if !connection.Connected() {
		middleware.WriteError(w, r, http.StatusUnprocessableEntity,
			"No tienes una cuenta de Gmail conectada, así que no se puede enviar nada. "+
				"Conéctala en tu perfil y vuelve a intentarlo.")
		return false
	}
	return true
}

// TestSend runs the whole batch to one address and changes nothing.
//
// The gates are Publish's, MINUS the already-published one, and the
// omission is the point of the route: rehearsing a control that has already
// gone out is exactly what a professor does when a student says nothing
// arrived. It stamps nothing, so it can be run as often as they like.
func (h *Controls) TestSend(w http.ResponseWriter, r *http.Request) {
	id, professor, ok := h.publishPreamble(w, r)
	if !ok {
		return
	}
	if err := r.ParseForm(); err != nil {
		middleware.WriteError(w, r, http.StatusBadRequest,
			"No se pudo leer el formulario. Inténtalo de nuevo.")
		return
	}

	to, ok := parseTestAddress(r.PostFormValue("to"))
	if !ok {
		middleware.WriteError(w, r, http.StatusUnprocessableEntity,
			"Esa dirección no parece un correo. Revísala y vuelve a intentarlo.")
		return
	}

	if _, ok := h.publishableControl(w, r, id); !ok {
		return
	}
	if !h.canSend(w, r, professor.ID) {
		return
	}

	payload, err := json.Marshal(controls.PublishPayload{
		ProfessorID: professor.ID,
		// A rehearsal is always addressed by TestTo, so the per-publication
		// mode is moot — it is recorded as `real` because that is what the
		// transport does with the message it is handed, and a `staging`
		// rehearsal would redirect the rehearsal away from the address the
		// professor just typed.
		Mode:   string(controls.PublishModeReal),
		TestTo: to,
	})
	if err != nil {
		h.Log.Error("test-send: encode the payload", "control", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió al preparar el envío de prueba. Vuelve a intentarlo.")
		return
	}
	if _, err := h.Runner.Submit(r.Context(), id, jobs.KindPublish, payload); err != nil {
		h.Log.Error("test-send: submit the job", "control", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"No se pudo encolar el envío de prueba. Vuelve a intentarlo en unos segundos.")
		return
	}

	// The address is echoed back because the professor just typed it and
	// this is the only chance to notice a typo before waiting for mail that
	// went somewhere else.
	flash.Set(w, h.secureCookie,
		"Empezó el envío de prueba a "+to+". Nadie del curso recibirá nada.")
	http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
}

// parseTestAddress validates the typed address.
//
// net/mail.ParseAddress rather than a regex, because the grammar it
// implements is RFC 5322's and a hand-rolled pattern is either wrong about
// a real address or permissive about a broken one. It also accepts the
// `Nombre <a@b>` form, which is why only the bare Address is kept — the
// display name would travel into a To header the professor did not intend.
func parseTestAddress(raw string) (string, bool) {
	parsed, err := mail.ParseAddress(strings.TrimSpace(raw))
	if err != nil || parsed.Address == "" {
		return "", false
	}
	return parsed.Address, true
}

// fillPublication populates the detail page's publication half.
//
// The three gates are the same ones the POST enforces, worded for a person
// rather than for a status code — and they are computed here rather than in
// the template because "why can I not press this" is policy, and a template
// that decided it would be a second place for the rule to live.
//
// A control that has NOT been graded shows nothing at all: publication is
// not something a professor is thinking about while copies are still under
// review, and a permanently disabled button on every fresh control is noise
// that teaches them to ignore disabled buttons.
func (h *Controls) fillPublication(r *http.Request, page *view.ControlDetailPage, c controls.Control) {
	page.PublishURL = controlPublishURL(c.ID)
	page.TestSendURL = controlTestSendURL(c.ID)

	if c.State != controls.Graded {
		return
	}

	connected := true
	if professor, ok := middleware.ProfessorFrom(r.Context()); ok {
		if connection, err := h.Gmail.Connection(r.Context(), professor.ID); err == nil {
			connected = connection.Connected()
		} else {
			// Same policy as the POST's canSend, and the same reason: a
			// lookup that blinked must not present a working account as a
			// missing one. The POST checks again.
			h.Log.Warn("detail: reading the Gmail connection",
				"professor", professor.ID, "error", err)
		}
	}

	page.Published = c.PublishedAt != nil
	if page.Published {
		page.PublishedLine = publishedLine(c)
	}

	// A rehearsal survives the real publication; only the account and the
	// course gate it.
	page.CanTestSend = connected && c.CourseID != nil

	switch {
	case page.Published:
		// No reason rendered: the published line above already says what
		// happened, and "ya fue publicado" beside it would be the same
		// sentence twice.
		page.CanPublish = false
	case c.CourseID == nil:
		page.PublishBlockedReason = "Asígnale un curso para saber a quién enviarle las correcciones."
	case !connected:
		page.PublishBlockedReason = "Conecta una cuenta de Gmail en tu perfil para poder enviar."
	default:
		page.CanPublish = true
	}
}

// publishedLine words what a published control shows instead of the button.
//
// The MODE is named, and that is the load-bearing half: a professor who
// rehearsed against themselves and one who mailed forty students are in
// very different situations, and a line saying only "Publicado" would read
// the same to both.
func publishedLine(c controls.Control) string {
	when := c.PublishedAt.Format("02-01-2006 15:04")
	if c.PublicationMode == controls.PublishModeStaging {
		return "Publicado el " + when + " en modo prueba: los correos fueron a tu propia dirección, " +
			"no a los estudiantes."
	}
	return "Publicado el " + when + ": las correcciones se enviaron a los estudiantes."
}
