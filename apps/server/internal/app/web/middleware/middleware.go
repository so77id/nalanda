// Package middleware turns a cookie into a professor, gates what needs one, and
// refuses a state-changing request that cannot prove it was intended.
//
// It lives under internal/app/web and nowhere else, which is the seam §C12 of
// the design draws: the backoffice serves an authenticated professor and the API
// surface serves anonymous students who join with a room code. Same process,
// opposite auth models. Mounting any of this on internal/app/api would put a
// login gate in front of the students, and the composition test in cmd/server
// asserts that it has not happened.
//
// The three middlewares are separate on purpose:
//
//	Resolve          runs on everything — it only ANSWERS who is asking.
//	RequireProfessor gates — it decides that an answer was required.
//	VerifyCSRF       refuses a state-changing request without the session's token.
//
// Collapsing them would make /health and /login require a session, which is how
// a container healthcheck starts failing for reasons nobody can see.
package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// SessionCookieName is the cookie the session token travels in. The __Host-
// prefix was considered and rejected: it requires Secure, which local
// development over http cannot satisfy, and a cookie name that differs between
// development and production is a difference that only ever shows up in
// production.
const SessionCookieName = "nalanda_session"

// CSRFFieldName is the form field every state-changing request carries.
const CSRFFieldName = "csrf_token"

// Auth holds what the middlewares need. Constructed once in cmd/server.
type Auth struct {
	Sessions auth.SessionStore
	Users    auth.UserStore
	// Now is the clock, injected so a test can move it rather than sleep.
	Now func() time.Time
	// PublicURL is what the cookie's Secure attribute is DERIVED from. It was a
	// SecureCookie bool, and deleting its wiring left the suite green while the
	// session cookie shipped without Secure over https, because false is a legal
	// value no constructor check can catch (#150 review, ARQ-10).
	PublicURL string
	// LoginPath is where RequireProfessor sends an anonymous request.
	//
	// Passed in, with no default and no constant in this package: the route
	// belongs to the surface that registers it. A default was tried and was
	// worse than none — it was a third "/login" literal that happened to agree
	// with the other two, so deleting the wiring left the suite green
	// (#150 review, ARQ-1 residual). NewAuth refuses an empty one, which turns
	// the omission into a failure at boot.
	LoginPath string
	Log       *slog.Logger

	// secureCookie is derived by NewAuth from PublicURL.
	secureCookie bool
}

// NewAuth returns the middlewares, refusing a set of dependencies it cannot
// serve with. Same reasoning as handler.NewAuth: a literal with a field
// forgotten compiles and panics inside a request instead of at boot
// (#150 review, ARQ-3).
func NewAuth(deps Auth) *Auth {
	switch {
	case deps.Sessions == nil:
		panic("middleware.NewAuth: no session store")
	case deps.Users == nil:
		panic("middleware.NewAuth: no user store")
	case deps.Now == nil:
		panic("middleware.NewAuth: no clock")
	case deps.LoginPath == "":
		panic("middleware.NewAuth: no login path — the surface that registers the route passes it in")
	case deps.Log == nil:
		panic("middleware.NewAuth: no logger")
	case deps.PublicURL == "":
		panic("middleware.NewAuth: no public URL — the cookie's Secure attribute is derived from it")
	}
	deps.secureCookie = config.SecureFor(deps.PublicURL)
	return &deps
}

// contextKey is unexported so that nothing outside this package can put a
// professor into a request context — the only way in is Resolve.
type contextKey int

const (
	professorKey contextKey = iota
	sessionKey
)

// ProfessorFrom returns the professor Resolve attached, if any.
func ProfessorFrom(ctx context.Context) (auth.User, bool) {
	user, ok := ctx.Value(professorKey).(auth.User)
	return user, ok
}

// SessionFrom returns the session Resolve attached, if any. Handlers need it for
// the CSRF token they put in a form.
func SessionFrom(ctx context.Context) (auth.Session, bool) {
	session, ok := ctx.Value(sessionKey).(auth.Session)
	return session, ok
}

// Resolve turns the session cookie into a professor on the request context.
//
// It never refuses a request. A missing, expired, unknown or deactivated session
// is simply an anonymous request from here on — the decision to require one
// belongs to RequireProfessor, one layer out.
func (a *Auth) Resolve(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(SessionCookieName)
		if err != nil || cookie.Value == "" {
			next.ServeHTTP(w, r)
			return
		}

		ctx := r.Context()
		hash := auth.HashToken(cookie.Value)

		session, err := a.Sessions.SessionByTokenHash(ctx, hash)
		if err != nil {
			if errors.Is(err, auth.ErrNotFound) {
				// The cookie names nothing. Clearing it stops the browser
				// sending it on every subsequent request forever.
				ClearSessionCookie(w, a.secureCookie)
				next.ServeHTTP(w, r)
				return
			}
			// A database that cannot answer is NOT a logged-out professor. The
			// cookie is left alone so the next request can resolve it once the
			// trouble passes; logging everyone out on a transient error is a
			// bigger outage than the one that caused it.
			a.Log.Error("resolving the session", "error", err)
			next.ServeHTTP(w, r)
			return
		}

		now := a.Now()
		if session.IsExpired(now) {
			// Swept here rather than by a job: this is the moment the row is
			// known to be useless, and it costs one DELETE that was already
			// going to be a round trip.
			a.deleteSession(ctx, hash)
			ClearSessionCookie(w, a.secureCookie)
			next.ServeHTTP(w, r)
			return
		}

		user, err := a.Users.UserByID(ctx, session.UserID)
		if err != nil {
			if errors.Is(err, auth.ErrNotFound) {
				a.deleteSession(ctx, hash)
				ClearSessionCookie(w, a.secureCookie)
				next.ServeHTTP(w, r)
				return
			}
			a.Log.Error("resolving the professor of a session", "error", err)
			next.ServeHTTP(w, r)
			return
		}

		if !user.MayLogIn() {
			// A professor deactivated while holding a live cookie is out on
			// their next request, and their session goes with them so the
			// decision does not have to be made again.
			a.Log.Info("refusing a deactivated professor", "professor", user.ID)
			a.deleteSession(ctx, hash)
			ClearSessionCookie(w, a.secureCookie)
			next.ServeHTTP(w, r)
			return
		}

		if err := a.Sessions.TouchSession(ctx, hash, now); err != nil {
			// Not fatal: last_seen_at is for an operator reading the table, and
			// failing the request over it would trade a real login for a
			// bookkeeping detail.
			a.Log.Warn("recording that the session was used", "error", err)
		}

		ctx = context.WithValue(ctx, professorKey, user)
		ctx = context.WithValue(ctx, sessionKey, session)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// deleteSession drops a session that has been decided against, logging rather
// than failing: the request's outcome is already settled and the professor is
// being logged out either way.
func (a *Auth) deleteSession(ctx context.Context, hash string) {
	if err := a.Sessions.DeleteSession(ctx, hash); err != nil {
		a.Log.Error("deleting an unusable session", "error", err)
	}
}

// RequireProfessor sends anyone Resolve did not recognise to the login page.
//
// A redirect rather than a 401: the reader is a person in a browser, and the
// useful answer to "you are not signed in" is the page that lets them sign in.
func (a *Auth) RequireProfessor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := ProfessorFrom(r.Context()); !ok {
			http.Redirect(w, r, a.LoginPath, http.StatusSeeOther)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// VerifyCSRF refuses a state-changing request that does not carry the session's
// own CSRF token.
//
// The safe methods are exempt because they change nothing, and because requiring
// a token on GET would mean every link in the backoffice carried one.
func (a *Auth) VerifyCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isSafeMethod(r.Method) {
			next.ServeHTTP(w, r)
			return
		}

		session, ok := SessionFrom(r.Context())
		if !ok {
			// No session means no token to compare against, and a
			// state-changing request from nobody is refused rather than
			// redirected: it was not a person following a link.
			http.Error(w, "Solicitud no autorizada.", http.StatusForbidden)
			return
		}

		// ParseForm is what populates PostFormValue, and its error is worth
		// refusing on: a body that cannot be parsed carries no token either.
		if err := r.ParseForm(); err != nil {
			http.Error(w, "Solicitud no autorizada.", http.StatusForbidden)
			return
		}

		if !auth.VerifyCSRF(session.CSRFToken, r.PostFormValue(CSRFFieldName)) {
			a.Log.Warn("refusing a request with no valid CSRF token",
				"professor", session.UserID, "path", r.URL.Path, "method", r.Method)
			http.Error(w, "Solicitud no autorizada.", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// isSafeMethod reports whether the method is one that changes nothing, per
// RFC 9110 §9.2.1. HEAD and OPTIONS are included because a browser issues them
// without a form.
func isSafeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	default:
		return false
	}
}

// SetSessionCookie writes the session cookie.
//
// Every attribute here is load-bearing: HttpOnly keeps a script from reading the
// token, SameSite=Lax keeps a cross-site form from riding the session while
// still letting a normal link into the backoffice work, Path scopes it to the
// whole site, and Secure is derived from the public URL rather than chosen.
func SetSessionCookie(w http.ResponseWriter, token string, expires time.Time, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearSessionCookie tells the browser to drop the session cookie.
//
// MaxAge below zero is what deletes it; an empty value with no MaxAge leaves a
// cookie in place that simply says nothing, and the browser keeps sending it.
func ClearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}
