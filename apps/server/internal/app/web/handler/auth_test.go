package handler_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/oauthstate"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/infra/oidc/oidctest"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// These drive the whole round trip — page, redirect, callback, cookie, logout —
// against a real database and the mock provider. What the mock stands in for is
// Google's network presence, not the verification: internal/infra/oidc proves
// that against a real key, and repeating it here would test the fixture.

const publicURL = "https://nalanda.test"

type fixture struct {
	store    *authstore.Store
	provider *oidctest.Provider
	auth     *handler.Auth
	mw       *middleware.Auth
	now      time.Time
}

func newFixture(t *testing.T, bootstrapEmail string) *fixture {
	t.Helper()

	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := storage.Migrate(ctx, db, migrations.FS); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	f := &fixture{
		store:    authstore.New(db),
		provider: &oidctest.Provider{Email: "profesora@example.com", Subject: "sub-1"},
		now:      time.Date(2026, time.August, 16, 12, 0, 0, 0, time.UTC),
	}
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))

	login := &auth.Login{
		Users:          f.store,
		Identities:     f.store,
		Sessions:       f.store,
		Now:            func() time.Time { return f.now },
		SessionTTL:     24 * time.Hour,
		BootstrapEmail: bootstrapEmail,
	}
	f.auth = &handler.Auth{
		Login:        login,
		Provider:     f.provider,
		ProviderName: "google",
		State:        oauthstate.New(time.Minute, func() time.Time { return f.now }),
		PublicURL:    publicURL,
		SecureCookie: true,
		Log:          quiet,
	}
	f.mw = &middleware.Auth{
		Sessions:     f.store,
		Users:        f.store,
		Now:          func() time.Time { return f.now },
		SecureCookie: true,
		Log:          quiet,
	}
	return f
}

// start runs GET /login/google and returns what a real browser would then be
// holding: the state nonce the provider was handed, and the cookie that binds it
// to this browser.
func (f *fixture) start(t *testing.T) (string, *http.Cookie) {
	t.Helper()

	recorder := httptest.NewRecorder()
	f.auth.LoginGoogle(recorder, httptest.NewRequest(http.MethodGet, handler.LoginGooglePath, nil))

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("starting the flow answered %d, want 303", recorder.Code)
	}
	return f.provider.LastState(), stateCookie(t, recorder)
}

// stateCookie pulls the state cookie out of a response, failing if it is absent:
// without it no callback can succeed, so its absence is never incidental.
func stateCookie(t *testing.T, recorder *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()

	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == handler.StateCookieName && cookie.Value != "" {
			return cookie
		}
	}
	t.Fatal("the response carries no state cookie")
	return nil
}

// callback runs the callback with the given state and code, carrying the state
// cookie when one is given — which is what a browser that started the flow does.
func (f *fixture) callback(t *testing.T, state, code string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()

	target := handler.LoginCallbackPath + "?state=" + url.QueryEscape(state) + "&code=" + url.QueryEscape(code)
	request := httptest.NewRequest(http.MethodGet, target, nil)
	if cookie != nil {
		request.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	f.auth.LoginGoogleCallback(recorder, request)
	return recorder
}

// sessionCookie returns the session cookie a response set, if any.
func sessionCookie(recorder *httptest.ResponseRecorder) *http.Cookie {
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == middleware.SessionCookieName && cookie.Value != "" {
			return cookie
		}
	}
	return nil
}

func TestTheLoginPageOffersGoogleToAnAnonymousVisitor(t *testing.T) {
	f := newFixture(t, "")

	recorder := httptest.NewRecorder()
	f.auth.LoginPage(recorder, httptest.NewRequest(http.MethodGet, handler.LoginPath, nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, handler.LoginGooglePath) {
		t.Error("the login page offers no way to sign in")
	}
	// The page a student might land on says what it is, in Spanish, and does not
	// pretend they need an account (ADR-0009).
	if !strings.Contains(body, "solo para profesores") {
		t.Errorf("the login page does not explain who it is for:\n%s", body)
	}
	if !strings.Contains(body, `lang="es"`) {
		t.Error("the page is not served as Spanish")
	}
}

// The refusal has to be visible to the person refused, not only in the log.
func TestTheLoginPageShowsWhyAnAccountWasRefused(t *testing.T) {
	f := newFixture(t, "")

	recorder := httptest.NewRecorder()
	f.auth.LoginPage(recorder, httptest.NewRequest(http.MethodGet, handler.LoginPath+"?aviso=no-es-profesor", nil))

	if !strings.Contains(recorder.Body.String(), "no pertenece a ningún profesor") {
		t.Errorf("the refusal is not shown to the person refused:\n%s", recorder.Body.String())
	}
}

// A message from the URL is rendered only if it is one of ours. Otherwise the
// login page shows whatever an attacker put in a link they sent.
func TestTheLoginPageIgnoresANoticeItDoesNotKnow(t *testing.T) {
	f := newFixture(t, "")

	target := handler.LoginPath + "?aviso=" + url.QueryEscape("Tu cuenta fue bloqueada, llama al 900-000-000")
	recorder := httptest.NewRecorder()
	f.auth.LoginPage(recorder, httptest.NewRequest(http.MethodGet, target, nil))

	if strings.Contains(recorder.Body.String(), "900-000-000") {
		t.Error("the login page rendered a message taken from the URL")
	}
}

func TestLoginGoogleRedirectsWithAStateAndTheConfiguredCallback(t *testing.T) {
	f := newFixture(t, "")

	recorder := httptest.NewRecorder()
	f.auth.LoginGoogle(recorder, httptest.NewRequest(http.MethodGet, handler.LoginGooglePath, nil))

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", recorder.Code)
	}
	if f.provider.LastState() == "" {
		t.Error("the provider was given no state nonce")
	}
	want := publicURL + handler.LoginCallbackPath
	if got := f.provider.LastRedirectURI(); got != want {
		t.Errorf("redirect URI = %q, want %q — it must come from the configuration, not the request", got, want)
	}
}

// AC-2, end to end: the bootstrap professor arrives through the callback.
func TestTheCallbackBootstrapsTheFirstProfessorAndOpensASession(t *testing.T) {
	f := newFixture(t, "profesora@example.com")

	state, stateCookie := f.start(t)
	recorder := f.callback(t, state, "the-code", stateCookie)

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", recorder.Code)
	}
	cookie := sessionCookie(recorder)
	if cookie == nil {
		t.Fatal("the callback set no session cookie")
	}

	// The cookie resolves to the professor the login created.
	session, err := f.store.SessionByTokenHash(context.Background(), auth.HashToken(cookie.Value))
	if err != nil {
		t.Fatalf("the cookie matches no session: %v", err)
	}
	professor, err := f.store.UserByID(context.Background(), session.UserID)
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if professor.Email != "profesora@example.com" {
		t.Errorf("the session belongs to %q", professor.Email)
	}
}

// AC-1: a verified Google account that belongs to nobody gets in nowhere, and
// leaves nothing behind.
func TestTheCallbackRefusesAnAccountThatIsNotAProfessor(t *testing.T) {
	f := newFixture(t, "")
	f.provider.Email = "cualquiera@example.com"
	f.provider.Subject = "sub-stranger"

	state, cookie := f.start(t)
	recorder := f.callback(t, state, "the-code", cookie)

	if cookie := sessionCookie(recorder); cookie != nil {
		t.Error("a refused account was given a session cookie")
	}
	if location := recorder.Header().Get("Location"); !strings.Contains(location, "no-es-profesor") {
		t.Errorf("Location = %q, want the login page saying why", location)
	}
	count, err := f.store.CountUsers(context.Background())
	if err != nil {
		t.Fatalf("CountUsers: %v", err)
	}
	if count != 0 {
		t.Errorf("%d professor(s) exist after a refusal, want 0", count)
	}
}

// The state nonce is the CSRF defence of the callback itself. A callback that
// arrives without one this server issued must not reach the provider at all —
// asserted by counting exchanges, since "it failed anyway" would also be true of
// an implementation that spent the code first and checked afterwards.
func TestTheCallbackRefusesAStateItNeverIssued(t *testing.T) {
	for _, c := range []struct{ name, state string }{
		{"no state at all", ""},
		{"a state from somewhere else", "a-nonce-nobody-issued"},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := newFixture(t, "profesora@example.com")
			_, cookie := f.start(t)

			recorder := f.callback(t, c.state, "the-code", cookie)

			if sessionCookie(recorder) != nil {
				t.Error("a callback with an unknown state opened a session")
			}
			if f.provider.Exchanges() != 0 {
				t.Error("the code was exchanged before the state was checked")
			}
		})
	}
}

// A callback replayed with the same state is refused: the nonce is spent.
func TestTheCallbackRefusesAReplayedState(t *testing.T) {
	f := newFixture(t, "profesora@example.com")
	state, stateCookie := f.start(t)

	if cookie := sessionCookie(f.callback(t, state, "the-code", stateCookie)); cookie == nil {
		t.Fatal("the first callback did not open a session")
	}

	recorder := f.callback(t, state, "the-code", stateCookie)
	if sessionCookie(recorder) != nil {
		t.Error("the same state opened a second session")
	}
}

func TestTheCallbackGivesUpWhenTheProviderRefuses(t *testing.T) {
	f := newFixture(t, "profesora@example.com")
	f.provider.Err = errors.New("the token signature does not verify")

	state, cookie := f.start(t)
	recorder := f.callback(t, state, "the-code", cookie)

	if sessionCookie(recorder) != nil {
		t.Error("a session was opened although the provider refused the exchange")
	}
	if location := recorder.Header().Get("Location"); !strings.Contains(location, "fallo") {
		t.Errorf("Location = %q, want the login page saying it failed", location)
	}
}

// The whole round trip, as a person performs it: sign in, be recognised, sign
// out, stop being recognised. This is the case that would catch a cookie the
// middleware cannot read — the two halves are written in different packages and
// nothing else makes them meet.
func TestSignInThenOutThroughTheMiddleware(t *testing.T) {
	f := newFixture(t, "profesora@example.com")

	state, stateCookie := f.start(t)
	cookie := sessionCookie(f.callback(t, state, "the-code", stateCookie))
	if cookie == nil {
		t.Fatal("the callback set no session cookie")
	}

	// Recognised: the login page now shows the signed-in state and a CSRF token.
	page := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, handler.LoginPath, nil)
	request.AddCookie(cookie)
	f.mw.Resolve(http.HandlerFunc(f.auth.LoginPage)).ServeHTTP(page, request)

	body := page.Body.String()
	if !strings.Contains(body, "profesora@example.com") {
		t.Errorf("the page does not show who is signed in:\n%s", body)
	}
	if !strings.Contains(body, handler.LogoutPath) {
		t.Error("the page offers no way to sign out")
	}

	session, err := f.store.SessionByTokenHash(context.Background(), auth.HashToken(cookie.Value))
	if err != nil {
		t.Fatalf("SessionByTokenHash: %v", err)
	}
	if !strings.Contains(body, session.CSRFToken) {
		t.Error("the logout form carries no CSRF token, so it could not be submitted")
	}

	// Signed out, through the CSRF middleware, as the form would do it.
	form := url.Values{}
	form.Set(middleware.CSRFFieldName, session.CSRFToken)
	logout := httptest.NewRequest(http.MethodPost, handler.LogoutPath, strings.NewReader(form.Encode()))
	logout.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	logout.AddCookie(cookie)

	out := httptest.NewRecorder()
	f.mw.Resolve(f.mw.RequireProfessor(f.mw.VerifyCSRF(http.HandlerFunc(f.auth.Logout)))).ServeHTTP(out, logout)

	if out.Code != http.StatusSeeOther {
		t.Fatalf("logout answered %d, want 303", out.Code)
	}
	if _, err := f.store.SessionByTokenHash(context.Background(), auth.HashToken(cookie.Value)); !errors.Is(err, auth.ErrNotFound) {
		t.Errorf("the session survived logout: %v", err)
	}

	// And the cookie the browser keeps is no longer a session.
	after := httptest.NewRecorder()
	stale := httptest.NewRequest(http.MethodGet, handler.LoginPath, nil)
	stale.AddCookie(cookie)
	f.mw.Resolve(http.HandlerFunc(f.auth.LoginPage)).ServeHTTP(after, stale)

	if strings.Contains(after.Body.String(), "profesora@example.com") {
		t.Error("the old cookie still signs the professor in after logout")
	}
}

// After the bootstrap has been used, the next stranger is refused end to end.
//
// Named for what it actually proves, which is less than it first claimed. It was
// TestTheBootstrapDoesNotAdmitASecondStranger, and removing the count check that
// closes the bootstrap left it green: this second account carries a different
// address, so it is refused by the address comparison and never reaches the
// count. The rule that the door closes behind the first professor is pinned by
// TestTheBootstrapClosesOnceAProfessorExists in the domain, where the case can
// be set up — same address, a professor already present. Found by mutation.
func TestAStrangerIsStillRefusedAfterTheBootstrapHasBeenUsed(t *testing.T) {
	f := newFixture(t, "profesora@example.com")

	first, firstCookie := f.start(t)
	if sessionCookie(f.callback(t, first, "the-code", firstCookie)) == nil {
		t.Fatal("the bootstrap login did not open a session")
	}

	f.provider.Email = "otra@example.com"
	f.provider.Subject = "sub-2"

	state, cookie := f.start(t)
	recorder := f.callback(t, state, "the-code", cookie)
	if sessionCookie(recorder) != nil {
		t.Error("a second account got in through a bootstrap that should have closed")
	}
}

// SEC-1, the finding this defence exists for, written as the attack.
//
// The server-side nonce store is one map for the whole process, so before the
// state cookie existed a nonce issued to ONE browser was accepted from ANY
// browser. The attacker starts a flow, keeps the redirect, and gets a professor
// to follow the callback: the professor's browser is then holding a session for
// the ATTACKER's Google account, and everything they type next goes into it.
//
// The exploit was demonstrated against this handler during review. This is it,
// inverted into a guard.
func TestACallbackFromAnotherBrowserIsRefused(t *testing.T) {
	f := newFixture(t, "profesora@example.com")

	// The attacker's browser starts a login and keeps both halves.
	attackerState, attackerCookie := f.start(t)

	// The victim's browser follows the callback link. It never visited
	// /login/google, so it holds no state cookie of its own.
	victim := f.callback(t, attackerState, "the-code", nil)

	if sessionCookie(victim) != nil {
		t.Error("a browser that never started a login was given a session")
	}
	if f.provider.Exchanges() != 0 {
		t.Error("the code was exchanged for a browser that started no login")
	}

	// And the nonce is still unspent, so the attacker's own browser — the one
	// that actually started the flow — can still complete it. The defence must
	// refuse the wrong browser, not break the right one.
	if sessionCookie(f.callback(t, attackerState, "the-code", attackerCookie)) == nil {
		t.Error("the browser that started the flow could not complete it")
	}
}

// The other half of the same defence: a browser cannot present its own cookie
// against somebody else's state, or the check would be satisfied by merely
// holding any cookie at all.
func TestACallbackWhoseCookieDoesNotMatchTheStateIsRefused(t *testing.T) {
	f := newFixture(t, "profesora@example.com")

	_, mine := f.start(t)
	theirState, _ := f.start(t)

	recorder := f.callback(t, theirState, "the-code", mine)

	if sessionCookie(recorder) != nil {
		t.Error("a callback whose cookie and state disagree opened a session")
	}
	if f.provider.Exchanges() != 0 {
		t.Error("the code was exchanged before the two halves were compared")
	}
}

// The state cookie carries the same protections as the session cookie, and is
// dropped as soon as it has been presented — a spent nonce left in the browser
// is an invitation to replay it.
func TestTheStateCookieIsProtectedAndSpentOnce(t *testing.T) {
	f := newFixture(t, "profesora@example.com")

	recorder := httptest.NewRecorder()
	f.auth.LoginGoogle(recorder, httptest.NewRequest(http.MethodGet, handler.LoginGooglePath, nil))
	cookie := stateCookie(t, recorder)

	if !cookie.HttpOnly {
		t.Error("the state cookie is readable by scripts")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Errorf("SameSite = %v, want Lax", cookie.SameSite)
	}
	if !cookie.Secure {
		t.Error("the state cookie is not Secure although the fixture is https")
	}

	state, live := f.start(t)
	done := f.callback(t, state, "the-code", live)

	var cleared bool
	for _, c := range done.Result().Cookies() {
		if c.Name == handler.StateCookieName && c.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Error("the state cookie survived the callback that spent it")
	}
}

// SEC-4. The decision "the session's IP comes from RemoteAddr and NOT from
// X-Forwarded-For" was a comment and nothing else — mutation showed a line
// honouring the header could be added with the whole suite green. Nothing sits
// in front of this server, so that header is client-supplied.
func TestTheSessionIPIgnoresAForgeableHeader(t *testing.T) {
	f := newFixture(t, "profesora@example.com")
	state, stateCookie := f.start(t)

	target := handler.LoginCallbackPath + "?state=" + url.QueryEscape(state) + "&code=the-code"
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.AddCookie(stateCookie)
	request.Header.Set("X-Forwarded-For", "203.0.113.9")
	request.RemoteAddr = "192.0.2.10:54321"

	recorder := httptest.NewRecorder()
	f.auth.LoginGoogleCallback(recorder, request)

	cookie := sessionCookie(recorder)
	if cookie == nil {
		t.Fatal("the callback set no session cookie")
	}
	session, err := f.store.SessionByTokenHash(context.Background(), auth.HashToken(cookie.Value))
	if err != nil {
		t.Fatalf("SessionByTokenHash: %v", err)
	}

	if session.IPAddress == "203.0.113.9" {
		t.Error("the session recorded the address from X-Forwarded-For, which any caller can choose")
	}
	if session.IPAddress != "192.0.2.10" {
		t.Errorf("IPAddress = %q, want the host of RemoteAddr", session.IPAddress)
	}
}

// The page carrying a professor's address and their CSRF token must not be
// cacheable or framable (SEC-3).
func TestTheRenderedPageCarriesItsSecurityHeaders(t *testing.T) {
	f := newFixture(t, "")

	recorder := httptest.NewRecorder()
	f.auth.LoginPage(recorder, httptest.NewRequest(http.MethodGet, handler.LoginPath, nil))

	for header, want := range map[string]string{
		"Cache-Control":          "no-store",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
	} {
		if got := recorder.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}
