// Package flash carries a one-shot message across a POST → redirect → GET.
//
// A screen that mutates state redirects to a GET (POST/redirect/GET is what
// keeps a reload from redoing the mutation), and the redirected page then
// needs to say what happened. The alternatives were both rejected in
// issue #151 §Flash:
//
//   - A ?aviso= query parameter reads well on a public route with no session
//     (which is exactly what /login uses). On a mutation it lands in the URL
//     bar, in the browser history, in the page title, and in the access logs
//     of the proxy #162 puts in front — and re-shows on reload, telling the
//     professor they created something twice.
//   - Server-side per-session storage would need a table and a sweep; a
//     handful of professors on a single-binary server is not that.
//
// So: a small cookie, HttpOnly, cleared in the response that reads it, so it
// survives exactly one render.
package flash

import (
	"encoding/base64"
	"net/http"
)

// CookieName is the browser-visible name.
//
// nalanda_ prefix so it sits beside nalanda_session and nalanda_oauth_state
// under one namespace; a professor deleting "nalanda cookies" from a browser
// UI gets the whole set together.
const CookieName = "nalanda_flash"

// Set writes a one-shot message.
//
// Base64URL rather than the raw string: cookie values reject spaces, commas
// and semicolons per RFC 6265, and every message here is Spanish text with
// punctuation the raw form would break on — silently, because the header
// would be truncated before the first space rather than refused.
func Set(w http.ResponseWriter, secure bool, message string) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    base64.URLEncoding.EncodeToString([]byte(message)),
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// Consume returns the message and clears the cookie in the SAME response.
//
// Clearing here rather than in a separate call is the whole point: a caller
// that reads the flash and forgets to clear it would show it on every
// subsequent page — the "created it twice" symptom this cookie exists to
// avoid.
//
// A cookie whose value does not decode is treated as no flash and cleared
// anyway: a stray value from an earlier encoding must not stay forever.
func Consume(w http.ResponseWriter, r *http.Request, secure bool) string {
	cookie, err := r.Cookie(CookieName)
	if err != nil {
		return ""
	}

	clear(w, secure)

	decoded, err := base64.URLEncoding.DecodeString(cookie.Value)
	if err != nil {
		return ""
	}
	return string(decoded)
}

// clear writes the deletion cookie. Same attributes as Set except MaxAge < 0,
// which is what tells the browser to drop the cookie; an empty value alone
// leaves the cookie in place with an empty string and the browser keeps
// sending it.
func clear(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}
