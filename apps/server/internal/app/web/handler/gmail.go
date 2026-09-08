package handler

import (
	"errors"
	"net/http"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/oauthstate"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/domain/gmail"
)

// The Gmail connection's routes (issue #273). English paths, Spanish page,
// the rule #150 set and #151 restated.
//
// They live under /profile because that is what they are about: the
// professor's own account, beside the Canvas token, not a global setting.
const (
	// ProfileGmailConnectPath starts the consent flow. A POST, unlike the
	// login's GET /login/google, because the login is a public page whose
	// whole purpose is that button while this one is an action a
	// signed-in professor takes — so it gets the CSRF check the router
	// gives every state-changing route, and a third party cannot bounce a
	// professor into a consent screen.
	ProfileGmailConnectPath = "/profile/gmail"
	// ProfileGmailCallbackPath is where Google returns. A GET, because
	// Google chooses the method.
	ProfileGmailCallbackPath = "/profile/gmail/callback"
	// ProfileGmailDisconnectPath removes both halves of the credential.
	ProfileGmailDisconnectPath = "/profile/gmail/disconnect"
)

// gmailStateCookieBase is the unprefixed name. See GmailStateCookieName.
const gmailStateCookieBase = "nalanda_gmail_state"

// GmailStateCookieName carries this flow's state nonce back to the browser
// that started it.
//
// A DIFFERENT NAME from StateCookieName, and a different oauthstate.Store
// behind it, and neither is incidental. They are what make the two flows
// unable to complete each other: a login callback presenting a login nonce
// finds no Gmail cookie and consumes nothing from the Gmail store, and a
// Gmail callback presenting a Gmail nonce is refused by the login the same
// way. Sharing either half would mean a nonce issued for one purpose could
// be spent on the other — and the two grants carry different scopes, so
// the confusion is not academic.
//
// Same __Host- prefixing rule and the same reason as StateCookieName and
// middleware.SessionCookieName: read and write it ONLY through here.
func GmailStateCookieName(secure bool) string {
	if secure {
		return "__Host-" + gmailStateCookieBase
	}
	return gmailStateCookieBase
}

// gmailCallbackURI is what this server registers with Google and what it
// must send unchanged on both legs — Google matches it character for
// character, and a mismatch is a redirect_uri_mismatch the professor
// cannot act on.
func (p *Profile) gmailCallbackURI() string {
	return p.PublicURL + ProfileGmailCallbackPath
}

// ConnectGmail starts the consent flow.
func (p *Profile) ConnectGmail(w http.ResponseWriter, r *http.Request) {
	if _, ok := middleware.ProfessorFrom(r.Context()); !ok {
		middleware.WriteError(w, r, http.StatusForbidden, "Tu sesión no está activa.")
		return
	}

	nonce, err := p.GmailState.Issue()
	if err != nil {
		if errors.Is(err, oauthstate.ErrBusy) {
			p.Log.Warn("refusing a Gmail connection attempt: too many in flight")
			flash.Set(w, p.secureCookie,
				"El servidor está ocupado. Vuelve a intentarlo en un momento.")
		} else {
			p.Log.Error("issuing a Gmail state nonce", "error", err)
			flash.Set(w, p.secureCookie,
				"No se pudo iniciar la conexión con Gmail. Vuelve a intentarlo.")
		}
		http.Redirect(w, r, ProfilePath, http.StatusSeeOther)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     GmailStateCookieName(p.secureCookie),
		Value:    nonce,
		Path:     "/",
		MaxAge:   int(oauthstate.DefaultTTL.Seconds()),
		HttpOnly: true,
		Secure:   p.secureCookie,
		// Lax, like the session cookie beside it. Google returns the
		// professor here with a top-level GET, which Lax allows and Strict
		// would drop — and dropping it would make every connection fail
		// the state check it just passed.
		SameSite: http.SameSiteLaxMode,
	})

	http.Redirect(w, r, p.Gmail.ConnectURL(nonce, p.gmailCallbackURI()), http.StatusSeeOther)
}

// clearGmailStateCookie drops the nonce. Called on every exit from the
// callback, successful or not: a nonce that has been presented once is
// spent whatever the outcome, and leaving it in the browser only invites a
// replay.
func (p *Profile) clearGmailStateCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     GmailStateCookieName(p.secureCookie),
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   p.secureCookie,
		SameSite: http.SameSiteLaxMode,
	})
}

// GmailCallback completes the consent.
//
// Gated like every other /profile route, which the LOGIN callback cannot
// be: this one identifies the professor from their existing session rather
// than from the token it is about to receive. That is the whole difference
// between the two callbacks — the login is how a session begins, and this
// one attaches a credential to a session that already exists.
func (p *Profile) GmailCallback(w http.ResponseWriter, r *http.Request) {
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		middleware.WriteError(w, r, http.StatusForbidden, "Tu sesión no está activa.")
		return
	}

	query := r.URL.Query()
	state := query.Get("state")

	// Both halves of the state check, before the code is spent — the same
	// pair, in the same order, and for the same reasons as
	// Auth.LoginGoogleCallback.
	//
	// CookiesNamed rather than Cookie, with the count checked, because
	// this is a double-submit cookie and its classic weakness is cookie
	// TOSSING: an attacker who can write on a sibling host of the same
	// registrable domain plants a nonce under a deeper Path, RFC 6265 §5.4
	// orders longer paths first, and r.Cookie would hand back theirs. The
	// count is what closes it, and it works over http, which the __Host-
	// prefix does not (#150 review, SEC-5).
	cookies := r.CookiesNamed(GmailStateCookieName(p.secureCookie))
	p.clearGmailStateCookie(w)
	if len(cookies) != 1 || !auth.VerifyCSRF(cookies[0].Value, state) {
		p.Log.Warn("refusing a Gmail callback whose state was not issued to this browser",
			"professor", professor.ID, "cookies", len(cookies))
		p.gmailFailed(w, r, "No se pudo verificar la vuelta desde Google. Vuelve a intentarlo.")
		return
	}

	// And single-use, from THIS flow's store. A login nonce consumes
	// nothing here, which is half of what keeps the two flows apart.
	if !p.GmailState.Consume(state) {
		p.Log.Warn("refusing a Gmail callback whose state matches no attempt", "professor", professor.ID)
		p.gmailFailed(w, r, "Esa vuelta desde Google ya no es válida. Vuelve a intentarlo.")
		return
	}

	code := query.Get("code")
	if code == "" {
		// The ordinary refusal: the professor pressed "Cancelar" on the
		// consent screen. Info, not error — a person declining is the
		// system working.
		p.Log.Info("the professor did not grant the Gmail consent",
			"professor", professor.ID, "error", query.Get("error"))
		p.gmailFailed(w, r, "No se conectó ninguna cuenta: no diste el permiso.")
		return
	}

	address, err := p.Gmail.Complete(r.Context(), professor.ID, code, p.gmailCallbackURI())
	switch {
	case err == nil:
	case errors.Is(err, gmail.ErrScopeNotGranted):
		// The one refusal a professor causes by accident and cannot
		// diagnose: the send permission is a separate tick-box on Google's
		// screen, and approving the screen with it unticked looks like
		// approving the screen.
		p.Log.Warn("the Gmail consent did not grant the send permission", "professor", professor.ID)
		p.gmailFailed(w, r, "Diste el acceso pero dejaste sin marcar el permiso para enviar "+
			"correo. Vuelve a conectar y asegúrate de dejar marcada esa casilla.")
		return
	case errors.Is(err, gmail.ErrNoRefreshToken):
		// The one failure whose message has to explain something the
		// professor cannot see. Google withholds the long-lived half when
		// the account has already granted this scope; the repair is to
		// remove Nalanda from the account's permissions and connect again.
		p.Log.Warn("the Gmail consent returned no refresh token", "professor", professor.ID)
		p.gmailFailed(w, r, "Google no entregó el permiso duradero que hace falta para enviar "+
			"correos más tarde. Quita el acceso de Nalanda en la página de permisos de tu "+
			"cuenta de Google y vuelve a conectarla.")
		return
	case errors.Is(err, gmail.ErrUnavailable):
		p.Log.Warn("could not reach Google to complete the Gmail consent",
			"professor", professor.ID, "error", err)
		p.gmailFailed(w, r, "No se pudo contactar a Google. No se guardó nada; "+
			"inténtalo de nuevo en un momento.")
		return
	default:
		p.Log.Error("completing the Gmail consent", "professor", professor.ID, "error", err)
		p.gmailFailed(w, r, "No se pudo conectar la cuenta de Gmail. Vuelve a intentarlo.")
		return
	}

	// The address is echoed because the professor may have picked an
	// account other than the one they log in with, and this is the only
	// moment they can catch it.
	flash.Set(w, p.secureCookie, "Gmail conectado como "+address+".")
	http.Redirect(w, r, ProfilePath, http.StatusSeeOther)
}

// DisconnectGmail removes both halves of the credential.
func (p *Profile) DisconnectGmail(w http.ResponseWriter, r *http.Request) {
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		middleware.WriteError(w, r, http.StatusForbidden, "Tu sesión no está activa.")
		return
	}

	if err := p.Gmail.Disconnect(r.Context(), professor.ID); err != nil {
		p.Log.Error("disconnecting Gmail", "professor", professor.ID, "error", err)
		flash.Set(w, p.secureCookie, "No se pudo desconectar la cuenta. Vuelve a intentarlo.")
		http.Redirect(w, r, ProfilePath, http.StatusSeeOther)
		return
	}

	// Deliberately says what the professor has to do next. Disconnecting
	// is not a neutral act here: a control published after it fails for
	// every student, and the control page's refusal is the only other
	// place that would say so.
	flash.Set(w, p.secureCookie,
		"Cuenta de Gmail desconectada. No podrás publicar correcciones hasta que conectes una.")
	http.Redirect(w, r, ProfilePath, http.StatusSeeOther)
}

// gmailFailed flashes a Spanish sentence and returns the professor to the
// page the button is on. A redirect rather than a rendered error page: the
// professor's next action is always "press it again", and that button is
// on /profile.
func (p *Profile) gmailFailed(w http.ResponseWriter, r *http.Request, message string) {
	flash.Set(w, p.secureCookie, message)
	http.Redirect(w, r, ProfilePath, http.StatusSeeOther)
}
