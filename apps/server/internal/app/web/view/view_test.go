package view_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
)

// The shell is the surface WP-D onward hangs its screens off — layout,
// navigation, and error pages are built here (issue #151, S1). These cases pin
// what the layout does for every page that goes through it, so a later page
// cannot silently render bare.

func renderLogin(t *testing.T, page view.LoginPage) string {
	t.Helper()

	recorder := httptest.NewRecorder()
	if err := view.RenderLogin(recorder, page); err != nil {
		t.Fatalf("RenderLogin: %v", err)
	}
	return recorder.Body.String()
}

// AC-4: the bar carries the sections on the left and the professor's menu on
// the right, and the menu opens with JavaScript disabled — <details>/<summary>
// is what makes that true.
func TestTheLayoutRendersTheBarForASignedInProfessor(t *testing.T) {
	body := renderLogin(t, view.LoginPage{
		Page: view.Page{
			Professor: &auth.User{Email: "profesora@example.com", Name: "Profesora"},
			CSRFToken: "csrf-token-goes-here",
		},
	})

	for _, want := range []string{
		// The sections half, with the one entry the shell already has room for.
		`class="sections"`,
		`href="/professors"`,
		// The professor's menu, opened by <details>/<summary> so JavaScript is
		// not required.
		`<details class="menu"`,
		`<summary`,
		`profesora@example.com`,
		// Logout is inside the menu and stays a POST with its CSRF token.
		`method="post" action="/logout"`,
		`name="csrf_token" value="csrf-token-goes-here"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("body missing %q\n---\n%s", want, body)
		}
	}
}

// A page rendered for an anonymous visitor does NOT carry the bar: nobody is
// signed in, and a menu naming "" as the professor would be a menu the login
// page ships with no owner.
func TestTheLayoutHidesTheBarForAnAnonymousVisitor(t *testing.T) {
	body := renderLogin(t, view.LoginPage{Aviso: "cualquier cosa"})

	for _, unwanted := range []string{
		`class="sections"`,
		`class="menu"`,
		`action="/logout"`,
	} {
		if strings.Contains(body, unwanted) {
			t.Errorf("body carries %q, want the bar hidden for an anonymous visitor\n---\n%s", unwanted, body)
		}
	}

	// The page still says what it exists to say and offers the way in.
	for _, want := range []string{`href="/login/google"`, "cualquier cosa"} {
		if !strings.Contains(body, want) {
			t.Errorf("body missing %q\n---\n%s", want, body)
		}
	}
}

// Both themes come from `color-scheme: light dark` and every colour is a tint of
// `currentColor`. Asserting on the stylesheet keeps a fixed hex from creeping
// in and turning the light theme unreadable on the dark one, or the other way
// round.
func TestTheLayoutStyleIsThemeAgnostic(t *testing.T) {
	body := renderLogin(t, view.LoginPage{})

	if !strings.Contains(body, "color-scheme: light dark") {
		t.Error("body missing color-scheme declaration: both themes must be honoured")
	}
	// Nothing here should name a fixed colour. Reading the surrounding
	// characters would be cleaner but this asserts the whole document, which is
	// what matters at review time.
	for _, forbidden := range []string{"#fff", "#000", "rgb(", "rgba("} {
		if strings.Contains(strings.ToLower(body), forbidden) {
			t.Errorf("body carries a fixed colour %q; the shell must stay currentColor-only", forbidden)
		}
	}
}

// The layout itself is one HTML document and one <body>. A second render must
// not stitch two layouts together — the failure mode the pages/ + layout split
// exists to prevent.
func TestARenderedPageHasExactlyOneBody(t *testing.T) {
	body := renderLogin(t, view.LoginPage{})
	if got := strings.Count(body, "<body"); got != 1 {
		t.Errorf("<body> count = %d, want 1", got)
	}
	if got := strings.Count(body, "<!doctype html>"); got != 1 {
		t.Errorf("doctype count = %d, want 1", got)
	}
}

// The layout shows a flash the caller stashed on the page, once, at the top of
// the content. `class="flash"` is the marker every page shares — a WP that
// wanted to hide the flash on a specific page would have to say so.
func TestTheLayoutRendersAFlash(t *testing.T) {
	body := renderLogin(t, view.LoginPage{
		Page: view.Page{Flash: "Profesor creado."},
	})

	if !strings.Contains(body, `class="flash"`) {
		t.Errorf("body missing flash marker\n---\n%s", body)
	}
	if !strings.Contains(body, "Profesor creado.") {
		t.Errorf("body missing the flash text\n---\n%s", body)
	}
}

func TestTheLayoutHidesTheFlashWhenEmpty(t *testing.T) {
	body := renderLogin(t, view.LoginPage{})
	if strings.Contains(body, `class="flash"`) {
		t.Error("the flash region rendered for an empty message; the page would carry an empty box")
	}
}

// AC-11: the error pages render THROUGH the shell rather than as Go's default
// text ("404 page not found\n"). Each of 404/403/500 goes through the same
// function; the case iterates them.
func TestRenderErrorGoesThroughTheShell(t *testing.T) {
	for _, c := range []struct {
		status  int
		message string
	}{
		{http.StatusNotFound, "Esta página no existe."},
		{http.StatusForbidden, "No tienes permiso para hacer eso."},
		{http.StatusInternalServerError, "Algo se rompió en el servidor."},
	} {
		t.Run(http.StatusText(c.status), func(t *testing.T) {
			recorder := httptest.NewRecorder()
			if err := view.RenderError(recorder, view.ErrorPage{
				Page:    view.Page{},
				Status:  c.status,
				Message: c.message,
			}); err != nil {
				t.Fatalf("RenderError: %v", err)
			}

			if recorder.Code != c.status {
				t.Errorf("status = %d, want %d", recorder.Code, c.status)
			}

			body := recorder.Body.String()
			// Every rendered page carries the shell markers, whether it is an
			// error or not — that is what "renders through the shell" means.
			for _, want := range []string{
				"<!doctype html>",
				"color-scheme: light dark",
				c.message,
			} {
				if !strings.Contains(body, want) {
					t.Errorf("body missing %q\n---\n%s", want, body)
				}
			}
			// The plain-text response Go writes by default. Its absence is
			// what a human reads to know the shell took over.
			if strings.HasPrefix(body, "404 page not found") {
				t.Errorf("body still looks like Go's default 404 text")
			}
			// Same security headers as every rendered page.
			for header, want := range map[string]string{
				"Cache-Control":           "no-store",
				"X-Content-Type-Options":  "nosniff",
				"X-Frame-Options":         "DENY",
				"Content-Security-Policy": "frame-ancestors 'none'",
				"Referrer-Policy":         "same-origin",
			} {
				if got := recorder.Header().Get(header); got != want {
					t.Errorf("%s = %q, want %q", header, got, want)
				}
			}
		})
	}
}

// An error page reached by a signed-in professor still shows the bar: they
// need a way out of the 404, and the way out is the shell they were reading
// three seconds ago.
func TestErrorPageForASignedInProfessorKeepsTheBar(t *testing.T) {
	recorder := httptest.NewRecorder()
	if err := view.RenderError(recorder, view.ErrorPage{
		Page: view.Page{
			Professor: &auth.User{Email: "profesora@example.com"},
			CSRFToken: "csrf-here",
		},
		Status:  http.StatusNotFound,
		Message: "Esta página no existe.",
	}); err != nil {
		t.Fatalf("RenderError: %v", err)
	}

	for _, want := range []string{
		`class="sections"`,
		`href="/professors"`,
		"profesora@example.com",
		`action="/logout"`,
		`value="csrf-here"`,
	} {
		if !strings.Contains(recorder.Body.String(), want) {
			t.Errorf("body missing %q — the bar should stay so a signed-in professor can leave the 404", want)
		}
	}
}
