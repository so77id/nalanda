package view_test

import (
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
