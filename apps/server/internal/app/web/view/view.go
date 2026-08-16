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
func RenderLogin(w http.ResponseWriter, status int, page LoginPage) error {
	var rendered bytes.Buffer
	if err := templates.ExecuteTemplate(&rendered, "login.html", page); err != nil {
		return fmt.Errorf("render the login page: %w", err)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, err := w.Write(rendered.Bytes())
	return err
}
