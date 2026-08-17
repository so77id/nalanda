// Package view renders the backoffice's HTML.
//
// One template today, and no layout. A layout with a single page in it is a
// directory that exists for its own sake — the same reasoning that kept
// /health answering JSON in #149 — and WP-C3, which brings the screens, is what
// makes a shared shell worth extracting.
//
// The templates are parsed ONCE at package initialisation and embedded in the
// binary. Parsing per request would turn a typo in a template into a 500 that
// only appears on the page nobody visits; parsing at start turns it into a
// panic at boot, which is a failure an operator sees immediately and a test can
// reproduce. This is the one place a panic is right (backend-code-style.md
// §Errors: never in a request path, fine at wiring time).
package view

import (
	"bytes"
	"embed"
	"fmt"
	"html/template"
	"net/http"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
)

//go:embed templates/*.html
var files embed.FS

var templates = template.Must(template.ParseFS(files, "templates/*.html"))

// LoginPage is what login.html renders.
//
// The whole professor is passed rather than an email string because the template
// asks whether there IS one — html/template treats a nil pointer and an empty
// struct differently, and "is somebody signed in" is exactly the question the
// page branches on.
type LoginPage struct {
	// Professor is nil for an anonymous visitor.
	Professor *auth.User
	// CSRFToken goes into the logout form. Empty when nobody is signed in,
	// because there is no form.
	CSRFToken string
	// Aviso is the Spanish message shown to someone who was refused or logged
	// out. Text a person reads, so it is Spanish, like everything else on this
	// surface (root CLAUDE.md).
	Aviso string
}

// RenderLogin writes the login page.
//
// It renders into a buffer first and only then writes to the ResponseWriter.
// Executing straight into the writer commits a 200 with the first byte, so a
// template that fails halfway produces a truncated page that claims to have
// succeeded — the same failure httpjson.Write exists to avoid on the other
// surface.
//
// The status is 200 and is not a parameter. It was one, with a single call site
// passing a single value; the third caller that needs another status is the one
// that should introduce it (#150 review, ARQ-8).
func RenderLogin(w http.ResponseWriter, page LoginPage) error {
	var rendered bytes.Buffer
	if err := templates.ExecuteTemplate(&rendered, "login.html", page); err != nil {
		return fmt.Errorf("render the login page: %w", err)
	}

	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, err := w.Write(rendered.Bytes())
	return err
}

// setSecurityHeaders is applied to every page this package renders, which is
// why it lives here rather than in a handler: WP-C3 adds its screens through
// this same function and inherits them without having to remember.
//
// What each one is for, since none of them is decoration:
//
//   - no-store, because the signed-in page carries the professor's address and
//     the session's CSRF token, and the public URL may be http in development —
//     where any intermediary is free to keep a copy.
//   - nosniff, so a rendering bug that emits the wrong bytes cannot be
//     re-interpreted as script.
//   - DENY, because the only form here is logout and framing it is
//     clickjacking with no upside. frame-ancestors says the same thing to
//     browsers that prefer CSP; both are sent because the set of browsers that
//     honour one and not the other is not worth tracking.
//   - same-origin referrers, because the login URL carries an `aviso` parameter
//     and the callback URL carries an authorization code, and neither belongs in
//     a third party's logs because a professor followed a link.
func setSecurityHeaders(w http.ResponseWriter) {
	header := w.Header()
	header.Set("Cache-Control", "no-store")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("X-Frame-Options", "DENY")
	header.Set("Content-Security-Policy", "frame-ancestors 'none'")
	header.Set("Referrer-Policy", "same-origin")
}
