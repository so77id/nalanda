package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

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
	// CopyPublishPath sends ONE copy's correction (issue #287).
	//
	// On the review page rather than the control page, because that is
	// where the professor already is when they finish re-correcting
	// somebody — and it is the manual override the staleness rule cannot
	// replace, for a re-annotation that moved the marks without moving the
	// total.
	CopyPublishPath = "/controls/{id}/copies/{copy}/publish"
	// ControlResendAllPath forgets every copy's stamp so the next Publicar
	// writes to the whole class again (issue #287).
	//
	// It occupies the slot "Deshacer la publicación" had and is named for
	// what it actually does, which that button was not: it never undid
	// anything. The case it exists for is the one the staleness rule cannot
	// see — the annotated PDFs were wrong and the grades were not.
	ControlResendAllPath = "/controls/{id}/resend-all"
)

// controlPublishURL and controlTestSendURL build the two POST targets, so
// the template and the redirects name each pattern once.
func controlPublishURL(id string) string  { return ControlsPath + "/" + id + "/publish" }
func controlTestSendURL(id string) string { return ControlsPath + "/" + id + "/test-send" }

// copyPublishDeadline bounds ONE per-student send end to end (issue #287
// review, ARQ-1 / F4).
//
// Twenty-five seconds, below httpserver's 30-second WriteTimeout, for the
// reason importDeadline is twenty: `http.Server`'s WriteTimeout neither
// aborts a handler nor cancels `r.Context()`, so without this the handler
// outlives the professor's connection. The transports underneath are
// bounded — 60 s on the Gmail client, 10 s on the token refresh — which
// means the worst case was ~70 s of work writing into a socket the server
// abandoned at 30, with the copy stamped and the professor told nothing.
// They press again, and the student gets two identical messages.
//
// The cost of choosing a number below the transport's: on a slow uplink a
// per-student send can give up where the batch job would have succeeded.
// That is the right trade — the copy is left unstamped, so pressing again
// or the next Publicar picks it up, while the other way round loses the
// professor's answer entirely.
const copyPublishDeadline = 25 * time.Second

func controlResendAllURL(id string) string { return ControlsPath + "/" + id + "/resend-all" }

func copyPublishURL(id string, copyNumber int) string {
	return fmt.Sprintf("%s/%s/copies/%d/publish", ControlsPath, id, copyNumber)
}

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

	if _, ok := h.publishableControl(w, r, id); !ok {
		return
	}
	// NO already-published gate (issue #287). It was a 409, and it was the
	// dead end the whole WP came out of: a partial run could not be
	// finished and a re-corrected copy could not be re-sent, so the only
	// way forward was to unpublish and mail the entire class again. With a
	// per-copy record a second Publicar is harmless by construction — every
	// copy whose student already holds the current correction is skipped —
	// so there is nothing left to refuse.
	if !h.canSend(w, r, professor.ID) {
		return
	}
	if !h.Service.DeliversMail() {
		// Refused HERE, on the page with the button, rather than by the job
		// three minutes later — and refused at all rather than run
		// silently. Under stub or dryrun every send "succeeds", so the old
		// behaviour stamped the control, showed a green banner and said the
		// class had been written to over nothing (#273 review, PUB-2). Since
		// stub is the default, that was the documented production path.
		middleware.WriteError(w, r, http.StatusUnprocessableEntity,
			"Este servidor no está configurado para enviar correo de verdad "+
				"(NALANDA_EMAIL_MODE), así que no se publicó nada.")
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
	// The flash says what this server will actually DO, not what the button
	// is called. Under a non-delivering transport a rehearsal reports three
	// successes and puts nothing in anybody's inbox — the same "green over
	// nothing" the publication gate exists to prevent, and three documents
	// used to tell the professor to rely on it (#273 review, NEW-1).
	message := "Empezó el envío de prueba a " + to + ". Nadie del curso recibirá nada."
	if !h.Service.DeliversMail() {
		message = "Este servidor está configurado para no enviar correo de verdad " +
			"(NALANDA_EMAIL_MODE), así que no llegará nada a " + to +
			". El aviso dirá que terminó igualmente."
	}
	flash.Set(w, h.secureCookie, message)
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

// PublishCopy sends one copy's correction, synchronously, and comes back
// to the review page the professor pressed it from.
//
// SYNCHRONOUS, unlike Publish, and the split is the rule in
// apps/server/CLAUDE.md rather than an exception to it: the shape of the
// WORK decides. One Gmail call plus one PDF is bounded and the professor is
// standing in front of it; forty of each is the loop nobody can wait on.
//
// It sends whatever state the copy is in. That is deliberate — it is the
// override for the case the grade comparison cannot see, a re-annotation
// that changed the marks without changing the total — and it is why there
// is no "ya está enviado" refusal here.
func (h *Controls) PublishCopy(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	copyNumber, ok := parseCopyPathValue(r.PathValue("copy"))
	if !isValidControlID(id) || !ok {
		middleware.WriteError(w, r, http.StatusNotFound, "Esa página no existe.")
		return
	}
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		// Unreachable behind RequireProfessor; a 403 rather than a panic is
		// what §Errors asks of a request path.
		middleware.WriteError(w, r, http.StatusForbidden, "Tu sesión no está activa.")
		return
	}
	// The courtesy gate, the same reason Publish carries one: the domain
	// checks again with the authority, but a professor with no connected
	// account is better told here than by a 500-shaped surprise.
	if !h.canSend(w, r, professor.ID) {
		return
	}
	// And the one gate the domain CANNOT apply (#287 review, SEC-3). This
	// route runs on the request goroutine, outside the runner's
	// single-goroutine serialisation (ADR-0050), so it is the only
	// publication path with no mutual exclusion against a batch in flight:
	// both would read the same unstamped row and mail the same student
	// twice. Refusing while a `publish` job is queued or running closes the
	// one crack in "pressing Publicar twice sends nobody a second copy".
	if h.publishJobInFlight(r.Context(), id) {
		flash.Set(w, h.secureCookie,
			"Hay un envío en curso para este control. Espera a que termine y vuelve a intentarlo.")
		http.Redirect(w, r, controlReviewURL(id, copyNumber), http.StatusSeeOther)
		return
	}

	// Its OWN deadline, never the request's (see copyPublishDeadline).
	ctx, cancel := context.WithTimeout(r.Context(), copyPublishDeadline)
	defer cancel()

	err := h.Service.PublishOne(ctx, id, copyNumber, professor.ID)
	switch {
	case err == nil:
		flash.Set(w, h.secureCookie, "Se envió la corrección de esta copia.")
	case errors.Is(err, controls.ErrSentButNotRecorded):
		// NOT a failure message. The student is holding their correction
		// and only the record of it is missing; "no se pudo enviar" would
		// invite a second press and a second copy (#287 review, COR-5).
		flash.Set(w, h.secureCookie,
			"La corrección salió, pero no se pudo registrar el envío. Si vuelves a "+
				"publicar, esta persona la recibirá por segunda vez.")
	case errors.Is(err, controls.ErrCopyNotDeliverable):
		// A guard refusal reaches the professor as flash + 303, not as a
		// 4xx (backend-code-style.md §Flash, issue #151 AC-8) — and here
		// that is not only convention: the sentence says "corrige el RUT
		// aquí arriba", which is an instruction only on the page that has
		// the form. An error page replaced it (#287 review, F5).
		flash.Set(w, h.secureCookie, copyNotDeliverableMessage(err))
	case errors.Is(err, controls.ErrControlNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return
	case errors.Is(err, controls.ErrReadingNotFound):
		middleware.WriteError(w, r, http.StatusNotFound,
			"Aún no hay una lectura para esta copia. Sube el escaneo primero.")
		return
	case errors.Is(err, controls.ErrNotGraded):
		// The remaining refusals stay 4xx: the page never offers the button
		// in these states, so reaching them means a hand-typed POST, and a
		// flash on a screen that shows no form explains nothing.
		middleware.WriteError(w, r, http.StatusUnprocessableEntity,
			"Todavía no se puede enviar: cierra la corrección primero.")
		return
	case errors.Is(err, controls.ErrNoCourse):
		middleware.WriteError(w, r, http.StatusUnprocessableEntity,
			"Este control no está asignado a un curso, así que no hay a quién enviarle nada.")
		return
	case errors.Is(err, controls.ErrCannotDeliver):
		middleware.WriteError(w, r, http.StatusUnprocessableEntity,
			"Este servidor no está configurado para enviar correo de verdad "+
				"(NALANDA_EMAIL_MODE), así que no se envió nada.")
		return
	case errors.Is(err, gmail.ErrNotConnected):
		middleware.WriteError(w, r, http.StatusUnprocessableEntity,
			"No tienes una cuenta de Gmail conectada, así que no se puede enviar nada. "+
				"Conéctala en tu perfil y vuelve a intentarlo.")
		return
	default:
		h.Log.Error("publish copy", "control", id, "copy", copyNumber, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"No se pudo enviar la corrección. Vuelve a intentarlo en unos segundos.")
		return
	}
	http.Redirect(w, r, controlReviewURL(id, copyNumber), http.StatusSeeOther)
}

// publishJobInFlight reports whether a batch publication is queued or
// running for this control (#287 review, SEC-3).
//
// A read failure answers FALSE — "no lo sé" must not block a send the
// professor is standing in front of, and the cost of letting one through
// is one duplicate message rather than a screen that refuses forever
// because a lookup blinked. Same policy, and the same reason, as
// canSend's and jobBannerFor's.
func (h *Controls) publishJobInFlight(ctx context.Context, controlID string) bool {
	job, err := h.Jobs.LatestForControlByKind(ctx, controlID, jobs.KindPublish)
	if err != nil {
		if !errors.Is(err, jobs.ErrJobNotFound) {
			h.Log.Warn("publish copy: reading the latest publish job",
				"control", controlID, "error", err)
		}
		return false
	}
	// jobs.Status.IsTerminal rather than `== StatusDone || == StatusFailed`
	// spelled inline — the rule #257's review set for every future
	// banner-consumer.
	return !job.Status.IsTerminal()
}

// ResendAll forgets every copy's stamp, so the next Publicar mails the
// class again.
//
// It sends nothing itself. The professor has just read how many people
// would receive a second copy; pressing the second button is how they say
// yes to that, and doing it for them would take the decision away in the
// one place it actually has to be made.
func (h *Controls) ResendAll(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !isValidControlID(id) {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return
	}

	cleared, err := h.Service.ResendToWholeCourse(r.Context(), id)
	switch {
	case err == nil:
	case errors.Is(err, controls.ErrControlNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return
	default:
		h.Log.Error("resend all", "control", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió al preparar el reenvío. Vuelve a intentarlo.")
		return
	}

	flash.Set(w, h.secureCookie, resendAllFlash(cleared))
	http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
}

// resendAllFlash says what just happened and what to press next.
//
// It names the number rather than saying "listo", because the number is the
// consequence the professor is about to cause and this is the last moment
// they can change their mind about it.
func resendAllFlash(cleared int) string {
	switch cleared {
	case 0:
		return "Ninguna copia estaba marcada como enviada, así que no cambió nada. " +
			"Publicar le enviará su corrección a todo el curso."
	case 1:
		return "Listo: 1 persona volverá a recibir su corrección cuando aprietes Publicar."
	default:
		return fmt.Sprintf("Listo: %d personas volverán a recibir su corrección cuando "+
			"aprietes Publicar.", cleared)
	}
}

// resendAllWarning is what the professor weighs BEFORE pressing it: how
// many people already have their correction, and therefore how many would
// get a second copy.
//
// The number is derived from the stamped readings, so it cannot be the
// stale count #273's column could become. A staging publication is the one
// case it would overstate — those copies are stamped and reached only the
// professor — which is why the published line above it says so.
func resendAllWarning(sent int) string {
	switch sent {
	case 0:
		// It does NOT say "nadie ha recibido su corrección". A control whose
		// stamps were already cleared reaches this branch too, and the
		// professor would then be told the class received nothing when they
		// may be holding it (#287 review, COR-2).
		return "Ninguna copia figura como enviada, así que esto no cambia nada: " +
			"Publicar ya le escribiría a todo el curso."
	case 1:
		return "1 persona ya recibió su corrección y la recibirá por segunda vez."
	default:
		return fmt.Sprintf("%d personas ya recibieron su corrección y la recibirán por "+
			"segunda vez.", sent)
	}
}

// copyNotDeliverableMessage names WHICH of the three reasons stopped the
// send, because each has a different repair and all three are reached from
// the same button. "No se pudo enviar" for all of them would send the
// professor to the wrong screen — the same reasoning as
// publishFailureReason one layer down.
func copyNotDeliverableMessage(err error) string {
	var refusal *controls.CopyNotDeliverableError
	if !errors.As(err, &refusal) {
		return "No hay nada que enviar para esta copia."
	}
	return copySkipMessage(refusal.Reason)
}

// copySkipMessage is the ONE home for those three sentences (#287 review,
// F5). The review page's disabled button and the domain's refusal both
// render them, and the professor must not read a different instruction
// depending on which of the two told them.
//
// "Aquí arriba" is literal: both readers put the sentence on the review
// page, above which the RUT field and the answer forms actually are. That
// is what makes the refusal a flash + 303 rather than a 4xx — an error
// page has no "arriba" (backend-code-style.md §Flash).
func copySkipMessage(reason controls.CopySkipReason) string {
	switch reason {
	case controls.SkipNoStudent:
		return "Esta copia no está asociada a nadie del curso, así que no hay a quién enviarle " +
			"la corrección. Corrige el RUT aquí arriba, o revisa la lista del curso."
	case controls.SkipNoGrade:
		return "Esta copia no tiene una nota definida, así que no hay qué enviar. Resuelve las " +
			"respuestas dudosas aquí arriba y vuelve a intentarlo."
	case controls.SkipNoAnnotated:
		return "Esta copia todavía no tiene su PDF corregido, así que el correo iría sin el " +
			"adjunto. Cierra la corrección para generarlo."
	default:
		return "No hay nada que enviar para esta copia."
	}
}

// fillPublication populates the detail page's publication half.
//
// The gates are the same ones the POST enforces, worded for a person rather
// than for a status code — and they are computed here rather than in the
// template because "why can I not press this" is policy, and a template
// that decided it would be a second place for the rule to live.
//
// A control that has NOT been graded shows nothing at all: publication is
// not something a professor is thinking about while copies are still under
// review, and a permanently disabled button on every fresh control is noise
// that teaches them to ignore disabled buttons.
func (h *Controls) fillPublication(r *http.Request, page *view.ControlDetailPage, c controls.Control, readings []controls.Reading) {
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

	sent := countSent(readings)
	if c.PublishedAt != nil {
		page.PublishedLine = publishedLine(c, sent)
	}
	// Offered on any graded control, not only a published one: the case it
	// covers is "the annotated PDFs were wrong", which a professor can be
	// in after sending copies one at a time from the review page.
	page.ResendAllURL = controlResendAllURL(c.ID)
	page.ResendAllWarning = resendAllWarning(sent)

	// A rehearsal survives the real publication; only the account and the
	// course gate it.
	page.CanTestSend = connected && c.CourseID != nil

	// Publicar stays offered AFTER a publication (issue #287). It is how a
	// professor finishes a partial run and how they send a re-corrected
	// copy to the one person whose grade moved — and it is safe to press,
	// because every copy already holding the current correction is skipped.
	switch {
	case !h.Service.DeliversMail():
		page.PublishBlockedReason = "Este servidor no está configurado para enviar correo " +
			"de verdad. El envío de prueba sí funciona."
	case c.CourseID == nil:
		page.PublishBlockedReason = "Asígnale un curso para saber a quién enviarle las correcciones."
	case !connected:
		page.PublishBlockedReason = "Conecta una cuenta de Gmail en tu perfil para poder enviar."
	default:
		page.CanPublish = true
	}
}

// countSent is how many copies of this control have actually been written
// to (issue #287).
//
// DERIVED from the stamped readings, which is why control.published_sent
// went away. That column was a stored copy of this number, written once
// after the loop, and it could disagree with reality in both directions: a
// run that died before the bookkeeping write left it NULL over a class that
// had been mailed, and it could not move at all when a single copy was
// re-sent afterwards. Counting the rows cannot be wrong.
func countSent(readings []controls.Reading) int {
	n := 0
	for _, reading := range readings {
		if reading.PublishedAt != nil {
			n++
		}
	}
	return n
}

// publishedLine words what a published control shows above the button.
//
// It reads BOTH the mode and the count, and needs both. The mode alone
// cannot tell a professor whether anything arrived — a `real` publication
// in which every send failed is stamped `real`, and the first version of
// this function told that professor "las correcciones se enviaron a los
// estudiantes" permanently, with the zero sitting on the same row (#273
// review, NEW-3).
//
// THE COUNT IS ASKED FIRST, and that ordering carries a fact the column
// cannot (#287 review, COR-1). Since a copy is stamped ONLY by a run that
// reached its student, a non-zero count proves the class was written to
// whatever `publication_mode` says — which matters because that column is
// written once, on the first publication: a professor who rehearses in
// `staging` and then publishes for real would otherwise read "los correos
// fueron a tu propia dirección" over twenty-five delivered messages.
//
// AND ZERO DOES NOT CLAIM ANYTHING (#287 review, COR-2). Two different
// situations reach it — a publication where every copy was skipped or
// failed, and one whose stamps "Reenviar a todo el curso" has just cleared
// — and nothing on the row distinguishes them. The earlier version asserted
// the first, so the page told a professor that nobody had received a
// correction the whole class was holding, one click after the flash said
// the opposite. That is the same mistake `published_sent`'s own migration
// names ("NULL is not zero"), re-entered through the derived count.
func publishedLine(c controls.Control, sent int) string {
	when := "Publicado el " + c.PublishedAt.Format("02-01-2006 15:04")

	switch {
	case sent > 1:
		return fmt.Sprintf("%s: %d copias figuran como enviadas a los estudiantes.", when, sent)
	case sent == 1:
		return when + ": 1 copia figura como enviada al estudiante."
	case c.PublicationMode == controls.PublishModeStaging:
		return when + " en modo prueba: los correos fueron a tu propia dirección, " +
			"no a los estudiantes."
	default:
		return when + ". Ninguna copia figura como enviada: o no salió ningún correo, " +
			"o las marcaste todas como no enviadas para reenviarlas."
	}
}
