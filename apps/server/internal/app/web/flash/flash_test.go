package flash_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
)

// The single-use flash cookie: a message written by a handler that redirected,
// consumed once on the next render, and gone from the browser after that read.
// It is NOT the ?aviso= query parameter the login page uses — that reads well
// on a public page and terribly on a mutation whose message would then land in
// the browser history, in the URL bar and in a proxy's access logs
// (issue #151 §Flash).

func TestSetWritesACookieWithTheRightAttributes(t *testing.T) {
	recorder := httptest.NewRecorder()

	flash.Set(recorder, false, "Profesor creado.")

	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies set = %d, want 1", len(cookies))
	}
	c := cookies[0]
	if c.Name != flash.CookieName {
		t.Errorf("Name = %q, want %q", c.Name, flash.CookieName)
	}
	if c.Value == "" {
		t.Error("Value is empty")
	}
	if c.Value == "Profesora creado." {
		t.Error("Value is the raw message: a cookie needs an encoding, or a message with a comma or a space breaks the header")
	}
	if !c.HttpOnly {
		t.Error("HttpOnly is false: a script must not read the flash")
	}
	if c.Path != "/" {
		t.Errorf("Path = %q, want %q", c.Path, "/")
	}
	if c.SameSite != http.SameSiteLaxMode {
		t.Errorf("SameSite = %v, want Lax", c.SameSite)
	}
	if c.Secure {
		t.Error("Secure = true when the caller asked for false")
	}
}

func TestSetOverHTTPSSetsSecure(t *testing.T) {
	recorder := httptest.NewRecorder()

	flash.Set(recorder, true, "hola")

	if c := recorder.Result().Cookies()[0]; !c.Secure {
		t.Error("Secure = false when the caller asked for true; the flash may then travel in clear")
	}
}

// The load-bearing half of flash: read the message once and clear the cookie in
// the same response. A message that stays after being read shows on reload,
// telling the professor they created something twice — the exact failure the
// query-parameter approach has and this cookie exists to avoid.
func TestConsumeReturnsTheMessageAndClearsTheCookie(t *testing.T) {
	written := httptest.NewRecorder()
	flash.Set(written, false, "Profesora desactivada.")
	cookie := written.Result().Cookies()[0]

	request := httptest.NewRequest(http.MethodGet, "/anything", nil)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()

	got := flash.Consume(response, request, false)

	if got != "Profesora desactivada." {
		t.Errorf("Consume = %q, want %q", got, "Profesora desactivada.")
	}

	// The response must SET a cleared cookie. Otherwise the browser keeps
	// sending the flash forever.
	cleared := response.Result().Cookies()
	if len(cleared) != 1 || cleared[0].Name != flash.CookieName {
		t.Fatalf("Consume wrote %d cookies, want the one that clears the flash", len(cleared))
	}
	if cleared[0].MaxAge >= 0 {
		t.Errorf("cleared cookie MaxAge = %d, want a negative value that tells the browser to drop it", cleared[0].MaxAge)
	}
	if cleared[0].Value != "" {
		t.Errorf("cleared cookie Value = %q, want empty", cleared[0].Value)
	}
}

func TestConsumeReturnsEmptyWhenNoCookieIsPresent(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	response := httptest.NewRecorder()

	got := flash.Consume(response, request, false)

	if got != "" {
		t.Errorf("Consume = %q, want empty when no cookie was sent", got)
	}
	if len(response.Result().Cookies()) != 0 {
		t.Error("Consume wrote a cookie for a request that carried none")
	}
}

// A cookie whose value is not what Set produces is treated as no flash. A
// stray value from a previous version of the encoding must not reach the page:
// html/template is what would escape it, but a garbled string in Spanish reads
// as a bug either way.
func TestConsumeReturnsEmptyOnMalformedValue(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.AddCookie(&http.Cookie{Name: flash.CookieName, Value: "@@not-what-set-writes@@"})
	response := httptest.NewRecorder()

	got := flash.Consume(response, request, false)

	if got != "" {
		t.Errorf("Consume = %q, want empty for a malformed value", got)
	}
	// It still clears the cookie — otherwise the bad value stays forever.
	if len(response.Result().Cookies()) != 1 {
		t.Error("Consume did not clear a malformed cookie; it will keep being read as empty forever")
	}
}

// A round-trip through Set → Consume must preserve non-ASCII characters and
// characters cookies do not accept raw (commas, spaces). Spanish is the
// backoffice's language and dropping accents in a flash message is exactly the
// wrong shape of bug for a UI convention piece.
func TestRoundTripPreservesSpanishText(t *testing.T) {
	message := "La cuenta profesora@example.com queda inactiva, y sus sesiones también."

	written := httptest.NewRecorder()
	flash.Set(written, false, message)
	c := written.Result().Cookies()[0]

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.AddCookie(c)
	response := httptest.NewRecorder()

	if got := flash.Consume(response, request, false); got != message {
		t.Errorf("Consume = %q, want %q", got, message)
	}

	// Sanity: the cookie header itself has no bare spaces or commas that would
	// have broken parsing.
	if strings.ContainsAny(c.Value, " ,;") {
		t.Errorf("encoded value contains cookie-hostile characters: %q", c.Value)
	}
}
