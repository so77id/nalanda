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
	// Flash is the one-shot message the flash package consumed on this GET,
	// if any. Rendered by the layout above the page's content, once, so a
	// mutation that redirects can say what happened without putting the
	// message in the URL (issue #151 §Flash).
	Flash string
}

// ProfessorsFormPage is what professors_new.html and (in S7)
// professors_edit.html render. It holds the values a submission carried and
// the errors validation produced — the WP's form / validation / error
// convention (issue #151 §Goals):
//
//   - the SAME page renders empty (GET), pre-filled (validation failure
//     re-render), and, when reusing this shape, with a pre-existing row
//     (S7's edit form);
//   - errors are field-keyed rather than a single blob, so the template can
//     mark each field with the message it broke on;
//   - the values the professor typed come back so they do not retype them.
//
// A form that lost the invalid input on refusal would tell a professor with a
// mistyped comma to type the whole thing again — a bad UX and a subtle
// invitation to type it differently the second time and hit a different
// validation branch.
type ProfessorsFormPage struct {
	Page
	Action  string
	Values  ProfessorFormValues
	Errors  map[string]string
	Submit  string
	Heading string
	// EmailReadonly is set by S7's edit form: the address is deliberately
	// not editable (issue #151 §Non-goals). The create form leaves it false.
	EmailReadonly bool
}

// ProfessorFormValues holds what the user typed. Rendered back into the
// inputs on a validation-failure re-render.
type ProfessorFormValues struct {
	Email string
	Name  string
}

// ProfessorsListPage is what professors_list.html renders. The row values
// are pre-formatted by the handler; see handler/professors.go for why.
type ProfessorsListPage struct {
	Page
	Professors []ListedProfessor
}

// ListedProfessor is one row of the CRUD's list, with every column already
// as a string a person reads. Not the domain's auth.User: dates are a
// formatted Spanish short date and state is a Spanish word, so the template
// carries no formatting logic and cannot get it wrong.
type ListedProfessor struct {
	ID         int64
	Email      string
	Name       string
	IsActive   bool
	State      string
	CreatedAt  string
	LastSignIn string
}

// ErrorPage is what error.html renders. AC-11: 404, 403 and 500 render
// through the shell rather than as Go's default text.
//
// Status is the numeric status shown to the reader — it is not what the
// RESPONSE carries, because the response status is a separate concern set by
// the caller through the writer. Keeping the two decoupled is what lets a
// caller shape one 500 as "the database is down" and another as "an internal
// error" without inventing a template per shape.
type ErrorPage struct {
	Page
	Status  int
	Message string
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
//
// status is a parameter rather than a constant so error pages can carry their
// own — a 404 or 500 rendered as 200 is exactly the "silent success" the
// buffer-first rule exists to prevent.
func render(w http.ResponseWriter, name string, status int, data any) error {
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
	w.WriteHeader(status)
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
	return render(w, "login", http.StatusOK, page)
}

// RenderProfessorsList writes the CRUD's list page.
func RenderProfessorsList(w http.ResponseWriter, page ProfessorsListPage) error {
	if page.Title == "" {
		page.Title = "Profesores"
	}
	return render(w, "professors_list", http.StatusOK, page)
}

// RenderProfessorsForm writes the CRUD's create/edit form.
//
// status is a parameter because this render has two callers with two
// meanings: 200 for a fresh GET, 422 for a re-render after a validation
// refusal. Rendering the refusal as 200 would look right in a browser and
// hide the rejection from anything reading the HTTP layer.
func RenderProfessorsForm(w http.ResponseWriter, status int, page ProfessorsFormPage) error {
	if page.Title == "" {
		page.Title = page.Heading
	}
	if page.Submit == "" {
		page.Submit = "Guardar"
	}
	return render(w, "professors_form", status, page)
}

// RenderError writes an error page through the shell (AC-11).
//
// The status is taken from page.Status: it is what the reader sees and what
// the response carries — a 404 rendered as 200 would look right in the browser
// and be wrong to every cache, script and log line that reads the HTTP layer.
func RenderError(w http.ResponseWriter, page ErrorPage) error {
	if page.Title == "" {
		page.Title = http.StatusText(page.Status)
	}
	return render(w, "error", page.Status, page)
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
