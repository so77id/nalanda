// Package view renders the backoffice's HTML.
//
// The shell born with WP-C3 (#151, S1). Every page renders through the layout
// in templates/layout.html — nav, both themes, embedded CSS — so a new page
// arrives with the shape the rest of the surface has, and cannot ship bare.
//
// The templates are parsed ONCE at package initialisation and embedded in the
// binary. Parsing per request would turn a typo in a template into a 500 that
// only appears on the page nobody visits; parsing at start turns it into a
// panic at boot, which is a failure an operator sees immediately and a test can
// reproduce. This is the one place a panic is right (backend-code-style.md
// §Errors: never in a request path, fine at wiring time).
//
// One *template.Template per page rather than one template set for all of them.
// Each page defines the `content` block the layout invokes; parsing every page
// into one set would leave the last-defined `content` visible to everything
// else — the shell would silently render whichever page happened to be parsed
// last on top of the layout. A clone per page is what keeps the pages
// independent.
package view

import (
	"bytes"
	"embed"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
)

//go:embed templates/layout.html templates/pages/*.html
var files embed.FS

var pages = mustParsePages()

// Page is the layout's contract. Every page struct embeds it so the shell can
// render the title and, when there is one, the professor's bar without knowing
// what specific data the page carries.
type Page struct {
	// Title goes into the <title>; " · Nalanda" is appended by the layout so
	// no page has to remember to.
	Title string
	// Professor is nil for an anonymous visitor. The layout hides the bar in
	// that case and centers the content, which is what makes the login page
	// look the same as it did before this shell existed.
	Professor *auth.User
	// CSRFToken goes into the logout form in the bar. Empty when Professor is
	// nil, because there is no form.
	CSRFToken string
}

func mustParsePages() map[string]*template.Template {
	layout, err := template.ParseFS(files, "templates/layout.html")
	if err != nil {
		panic("view: parse layout: " + err.Error())
	}

	entries, err := fs.ReadDir(files, "templates/pages")
	if err != nil {
		panic("view: read pages: " + err.Error())
	}

	out := make(map[string]*template.Template, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".html") {
			continue
		}
		clone, err := layout.Clone()
		if err != nil {
			panic("view: clone layout for " + entry.Name() + ": " + err.Error())
		}
		tmpl, err := clone.ParseFS(files, "templates/pages/"+entry.Name())
		if err != nil {
			panic("view: parse page " + entry.Name() + ": " + err.Error())
		}
		out[strings.TrimSuffix(entry.Name(), ".html")] = tmpl
	}
	return out
}

// render is the one function that writes a page. Every render function in this
// package delegates to it, so the buffer-before-header rule and the security
// headers are applied once — a new page cannot forget them.
func render(w http.ResponseWriter, name string, data any) error {
	tmpl, ok := pages[name]
	if !ok {
		return fmt.Errorf("view.render: unknown page %q", name)
	}

	var buf bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buf, "layout.html", data); err != nil {
		return fmt.Errorf("render %s: %w", name, err)
	}

	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, err := w.Write(buf.Bytes())
	return err
}

// LoginPage is what login.html renders. It embeds Page: title, professor and
// CSRF token are handled by the shell, and the page adds only what is unique
// to it — the aviso, the Spanish message shown to a visitor who was refused or
// logged out.
type LoginPage struct {
	Page
	Aviso string
}

// RenderLogin writes the login page.
//
// The status is 200 and is not a parameter. It was one, with a single call site
// passing a single value; the third caller that needs another status is the one
// that should introduce it (#150 review, ARQ-8).
func RenderLogin(w http.ResponseWriter, page LoginPage) error {
	if page.Title == "" {
		if page.Professor != nil {
			page.Title = "Sesión iniciada"
		} else {
			page.Title = "Entrar"
		}
	}
	return render(w, "login", page)
}

// setSecurityHeaders is applied to every page render() writes, which is why it
// lives here rather than in a handler: a new page inherits them without having
// to remember.
//
// What each one is for, since none of them is decoration:
//
//   - no-store, because the signed-in pages carry the professor's address and
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
