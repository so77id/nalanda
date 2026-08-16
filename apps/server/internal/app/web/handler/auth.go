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
	PublicURL    string
	SecureCookie bool
	Log          *slog.Logger
}

// Messages a person reads. Spanish, like everything on this surface; the
// identifiers around them stay English (root CLAUDE.md).
const (
	avisoNoEsProfesor  = "Esa cuenta de Google no pertenece a ningún profesor de este curso."
	avisoFalloEntrada  = "No se pudo completar la entrada con Google. Inténtalo de nuevo."
	avisoSesionCerrada = "Has cerrado la sesión."
)

// LoginPage renders the login page, which doubles as the signed-in page.
//
// One page rather than two because there is nothing else to show yet: the
// backoffice home is WP-C3's, and a second template today would exist only to
// say the same sentence in a different file.
func (a *Auth) LoginPage(w http.ResponseWriter, r *http.Request) {
	page := view.LoginPage{Aviso: avisoFor(r.URL.Query().Get("aviso"))}

	if professor, ok := middleware.ProfessorFrom(r.Context()); ok {
		page.Professor = &professor
		if session, ok := middleware.SessionFrom(r.Context()); ok {
			page.CSRFToken = session.CSRFToken
		}
	}

	if err := view.RenderLogin(w, http.StatusOK, page); err != nil {
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
	default:
		return ""
	}
}

// LoginGoogle starts the flow: a fresh nonce, then a redirect to the provider.
func (a *Auth) LoginGoogle(w http.ResponseWriter, r *http.Request) {
	nonce, err := a.State.Issue()
	if err != nil {
		a.Log.Error("issuing an OAuth state nonce", "error", err)
		a.redirectToLogin(w, r, "fallo")
		return
	}
	http.Redirect(w, r, a.Provider.AuthCodeURL(nonce, a.callbackURI()), http.StatusSeeOther)
}

// LoginGoogleCallback completes the flow.
func (a *Auth) LoginGoogleCallback(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	// The nonce is checked BEFORE the code is spent. A callback whose state does
	// not match an attempt this server started is not a login going wrong, it is
	// a request somebody else sent this browser — and it must not reach the
	// provider at all.
	if !a.State.Consume(query.Get("state")) {
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

	middleware.SetSessionCookie(w, token, session.ExpiresAt, a.SecureCookie)
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

	middleware.ClearSessionCookie(w, a.SecureCookie)
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
