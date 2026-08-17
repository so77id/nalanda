// Package handler holds the backoffice's HTTP handlers. Today that is the login
// round trip and nothing else; the screens are WP-C3 (#151).
package handler

import (
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/oauthstate"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// The routes of the login round trip, exported so that the router, the redirect
// URI and the tests all name them once.
const (
	LoginPath         = "/login"
	LoginGooglePath   = "/login/google"
	LoginCallbackPath = "/login/google/callback"
	LogoutPath        = "/logout"
)

// Auth is the login round trip: the page, the redirect to Google, the callback,
// and logout.
type Auth struct {
	Login        *auth.Login
	Provider     auth.OAuthProvider
	ProviderName string
	State        *oauthstate.Store

	// PublicURL is the base the callback URI is built from. It comes from the
	// configuration rather than from the request, because Google matches the
	// redirect URI against the one registered, character for character — and
	// because a URI built from the Host header is one a caller chooses.
	PublicURL string
	Log       *slog.Logger

	// secureCookie is DERIVED from PublicURL by NewAuth, never passed in.
	//
	// It was a field, and deleting its wiring in cmd/server left the whole suite
	// green while the session cookie shipped without Secure over https — false
	// is a legal value, so no constructor check can see the omission
	// (#150 review, ARQ-10). backend-code-style.md §HTTP already said it is
	// derived and never set by hand; now it cannot be.
	secureCookie bool
}

// NewAuth returns the handlers, refusing a set of dependencies it cannot serve
// with.
//
// backend-code-style.md §HTTP asks for "a closure over its dependencies,
// returned by a small constructor". Four handlers sharing seven dependencies are
// a struct rather than seven closures over the same values — but the half of the
// rule that was being lost is the constructor, and with it the moment a wiring
// mistake is caught. A literal &Auth{} with a field forgotten compiles and
// panics inside a request, which §Errors forbids outright (#150 review, ARQ-3).
//
// It panics, which is the one place this repo allows it: wiring time, in
// cmd/server, before the listener is open. A server that cannot log anyone in
// must not start and pretend.
func NewAuth(deps Auth) *Auth {
	switch {
	case deps.Login == nil:
		panic("handler.NewAuth: no login service")
	case deps.Provider == nil:
		panic("handler.NewAuth: no OAuth provider")
	case deps.ProviderName == "":
		panic("handler.NewAuth: no provider name")
	case deps.State == nil:
		panic("handler.NewAuth: no OAuth state store")
	case deps.PublicURL == "":
		panic("handler.NewAuth: no public URL")
	case deps.Log == nil:
		panic("handler.NewAuth: no logger")
	}
	deps.secureCookie = config.SecureFor(deps.PublicURL)
	return &deps
}

// Messages a person reads. Spanish, like everything on this surface; the
// identifiers around them stay English (root CLAUDE.md).
const (
	avisoNoEsProfesor  = "Esa cuenta de Google no pertenece a ningún profesor de este curso."
	avisoFalloEntrada  = "No se pudo completar la entrada con Google. Inténtalo de nuevo."
	avisoSesionCerrada = "Has cerrado la sesión."
	avisoOcupado       = "Hay demasiados intentos de entrada en curso. Vuelve a intentarlo."
)

// LoginPage renders the login page, which doubles as the signed-in page.
//
// One page rather than two because there is nothing else to show yet: the
// backoffice home is WP-C3's, and a second template today would exist only to
// say the same sentence in a different file.
func (a *Auth) LoginPage(w http.ResponseWriter, r *http.Request) {
	page := view.LoginPage{
		Page:  middleware.PageFor(r, ""), // RenderLogin picks the title
		Aviso: avisoFor(r.URL.Query().Get("aviso")),
	}

	if err := view.RenderLogin(w, page); err != nil {
		a.Log.Error("rendering the login page", "error", err)
	}
}

// avisoFor maps the query parameter onto a message. A closed set rather than the
// parameter itself: rendering an arbitrary string from the URL is how a page
// starts showing whatever an attacker put in a link they sent.
func avisoFor(key string) string {
	switch key {
	case "no-es-profesor":
		return avisoNoEsProfesor
	case "fallo":
		return avisoFalloEntrada
	case "sesion-cerrada":
		return avisoSesionCerrada
	case "ocupado":
		return avisoOcupado
	default:
		return ""
	}
}

// StateCookieName carries the OAuth state nonce back to the browser that
// started the flow. See LoginGoogle for why the server-side store is not enough
// on its own.
const StateCookieName = "nalanda_oauth_state"

// LoginGoogle starts the flow: a fresh nonce, then a redirect to the provider.
//
// The nonce goes to TWO places, and the second one is the load-bearing half.
// The server-side store makes it single-use, which stops a callback being
// replayed. It does NOT tie the attempt to a browser: the store is one map for
// the whole process, so a nonce issued to one visitor is a nonce any visitor can
// present. That is login CSRF, and it was demonstrated against this handler
// before this cookie existed — an attacker starts a flow, keeps the redirect,
// and feeds the callback to a professor's browser, which then holds a session
// for the ATTACKER's account and types into it (#150 review, SEC-1).
//
// So the nonce is also written to a cookie, and the callback requires the two to
// match. That is what makes the attempt this browser's.
func (a *Auth) LoginGoogle(w http.ResponseWriter, r *http.Request) {
	nonce, err := a.State.Issue()
	if err != nil {
		// A full store is not a broken server: it is a flood of anonymous
		// attempts, and the honest thing to tell this visitor is to try again.
		// Distinguished from a real failure so the message is not a lie and the
		// log line is not an alarm.
		if errors.Is(err, oauthstate.ErrBusy) {
			a.Log.Warn("refusing a login attempt: too many in flight")
			a.redirectToLogin(w, r, "ocupado")
			return
		}
		a.Log.Error("issuing an OAuth state nonce", "error", err)
		a.redirectToLogin(w, r, "fallo")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     StateCookieName,
		Value:    nonce,
		Path:     "/",
		MaxAge:   int(oauthstate.DefaultTTL.Seconds()),
		HttpOnly: true,
		Secure:   a.secureCookie,
		SameSite: http.SameSiteLaxMode,
	})

	http.Redirect(w, r, a.Provider.AuthCodeURL(nonce, a.callbackURI()), http.StatusSeeOther)
}

// clearStateCookie drops the state cookie. Called on every exit from the
// callback, successful or not: a nonce that has been presented once is spent
// whatever the outcome, and leaving it in the browser only invites a replay.
func (a *Auth) clearStateCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     StateCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   a.secureCookie,
		SameSite: http.SameSiteLaxMode,
	})
}

// LoginGoogleCallback completes the flow.
func (a *Auth) LoginGoogleCallback(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	state := query.Get("state")

	// Both halves of the state check, before the code is spent. A callback that
	// fails either is not a login going wrong, it is a request somebody else
	// sent this browser — and it must not reach the provider at all.
	//
	// First: does this browser hold the nonce it is presenting? Compared in
	// constant time through the same helper the CSRF field uses, because that is
	// exactly what this is — the CSRF defence of the login itself.
	// CookiesNamed, not Cookie, and the count is checked: this is a
	// double-submit cookie, and its one classic weakness is cookie TOSSING. An
	// attacker who can write on a sibling host of the same registrable domain
	// plants their own nonce under a deeper Path; RFC 6265 §5.4 orders longer
	// paths first, so r.Cookie would return THEIRS and the victim would end up
	// in the attacker's session after all — the original SEC-1 attack, restored.
	// Demonstrated against the first version of this fix (#150 review, SEC-5).
	//
	// Refusing when there is more than one is what closes it, and it works over
	// http, which the __Host- prefix does not (development).
	cookies := r.CookiesNamed(StateCookieName)
	a.clearStateCookie(w)
	if len(cookies) != 1 || !auth.VerifyCSRF(cookies[0].Value, state) {
		a.Log.Warn("refusing a callback whose state was not issued to this browser",
			"cookies", len(cookies))
		a.redirectToLogin(w, r, "fallo")
		return
	}

	// Second: was it issued by this server, and is this the first time it comes
	// back? The store is what makes it single-use.
	if !a.State.Consume(state) {
		a.Log.Warn("refusing a callback whose state matches no login attempt")
		a.redirectToLogin(w, r, "fallo")
		return
	}

	code := query.Get("code")
	if code == "" {
		// Google reports a refusal here — the professor pressed cancel on the
		// account chooser, most often.
		a.Log.Info("the provider returned no code", "error", query.Get("error"))
		a.redirectToLogin(w, r, "fallo")
		return
	}

	email, subject, err := a.Provider.Exchange(r.Context(), code, a.callbackURI())
	if err != nil {
		a.Log.Warn("the provider refused the exchange", "error", err)
		a.redirectToLogin(w, r, "fallo")
		return
	}

	professor, err := a.Login.Authenticate(r.Context(), a.ProviderName, subject, email)
	if err != nil {
		if errors.Is(err, auth.ErrNotAProfessor) {
			// Logged at info, not error: a stranger pressing the button is the
			// system working, and at error level it would be the loudest thing
			// in the log on a public page.
			a.Log.Info("refusing an account that belongs to no professor", "email", email)
			a.redirectToLogin(w, r, "no-es-profesor")
			return
		}
		a.Log.Error("authenticating a verified identity", "error", err)
		a.redirectToLogin(w, r, "fallo")
		return
	}

	token, session, err := a.Login.StartSession(r.Context(), professor.ID, r.UserAgent(), clientIP(r))
	if err != nil {
		a.Log.Error("starting a session", "error", err)
		a.redirectToLogin(w, r, "fallo")
		return
	}

	// last_login_at is what the CRUD list renders as "when did they last sign
	// in?" — see issue #151 §Last sign-in for why it cannot be read from
	// user_sessions.last_seen_at. Bookkeeping: a failure here does not deny
	// the login (the professor did sign in), it goes into the log so the
	// operator can see it. Same shape as middleware.TouchSession for
	// user_sessions.last_seen_at.
	if err := a.Login.RecordLastSignIn(r.Context(), professor.ID); err != nil {
		a.Log.Warn("recording the last sign-in", "error", err, "professor", professor.ID)
	}

	middleware.SetSessionCookie(w, token, session.ExpiresAt, a.secureCookie)
	a.Log.Info("professor signed in", "professor", professor.ID)
	http.Redirect(w, r, LoginPath, http.StatusSeeOther)
}

// Logout ends the session and clears the cookie. It is a POST, and the CSRF
// middleware runs in front of it: a logout reachable by GET is a logout any
// image tag on any page can perform.
func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(middleware.SessionCookieName); err == nil && cookie.Value != "" {
		if err := a.Login.EndSession(r.Context(), cookie.Value); err != nil {
			// The cookie is cleared regardless: from the professor's side the
			// logout has to succeed, and a session row that outlives it is a
			// row nothing can present a cookie for.
			a.Log.Error("ending a session", "error", err)
		}
	}

	middleware.ClearSessionCookie(w, a.secureCookie)
	a.redirectToLogin(w, r, "sesion-cerrada")
}

// callbackURI is the redirect URI, built from the configured public URL.
func (a *Auth) callbackURI() string {
	return strings.TrimSuffix(a.PublicURL, "/") + LoginCallbackPath
}

func (a *Auth) redirectToLogin(w http.ResponseWriter, r *http.Request, aviso string) {
	http.Redirect(w, r, LoginPath+"?aviso="+aviso, http.StatusSeeOther)
}

// clientIP is a best-effort record of where a session was opened from, for an
// operator reading the table. It reads RemoteAddr and NOT X-Forwarded-For:
// nothing sits in front of this server today, so that header is client-supplied
// and would put an attacker's chosen string in the database. The day a reverse
// proxy exists (§C15), this is where it is taught to trust one.
//
// net.SplitHostPort rather than a cut at the first colon, which would turn the
// IPv6 address [::1]:54321 into "[".
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
