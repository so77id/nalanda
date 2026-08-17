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

	login := auth.NewLogin(auth.Login{
		Users:          f.store,
		Identities:     f.store,
		Sessions:       f.store,
		Now:            func() time.Time { return f.now },
		SessionTTL:     24 * time.Hour,
		BootstrapEmail: bootstrapEmail,
	})
	f.auth = handler.NewAuth(handler.Auth{
		Login:        login,
		Provider:     f.provider,
		ProviderName: "google",
		State:        oauthstate.New(time.Minute, func() time.Time { return f.now }),
		PublicURL:    publicURL,
		// Default off: RemoteAddr owns the sessions table's IP column, which is
		// what `TestTheSessionIPIgnoresAForgeableHeader` reads. The other arm
		// lives in newTrustProxyFixture below.
		TrustProxyHeaders: false,
		Log:               quiet,
	})
	f.mw = middleware.NewAuth(middleware.Auth{
		Sessions:  f.store,
		Users:     f.store,
		Now:       func() time.Time { return f.now },
		PublicURL: publicURL,
		LoginPath: handler.LoginPath,
		Log:       quiet,
	})
	return f
}

// newTrustProxyFixture is newFixture with the deploy-behind-a-proxy switch on.
// Two callers only, both in this file: the tests that pin the WITH-flag arm of
// `Auth.clientIP`. Everything else uses newFixture — the default is the safe
// one, and turning the flag on everywhere would hide the without-flag arm.
func newTrustProxyFixture(t *testing.T, bootstrapEmail string) *fixture {
	t.Helper()
	f := newFixture(t, bootstrapEmail)
	f.auth = handler.NewAuth(handler.Auth{
		Login:             f.auth.Login,
		Provider:          f.auth.Provider,
		ProviderName:      f.auth.ProviderName,
		State:             f.auth.State,
		PublicURL:         f.auth.PublicURL,
		TrustProxyHeaders: true,
		Log:               f.auth.Log,
	})
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
//
// Accepts either of the two possible names — `__Host-nalanda_oauth_state` over
// https, `nalanda_oauth_state` over http — because #162 made the prefix a
// function of the URL scheme (`handler.StateCookieName`), and the tests that
// iterate over both schemes cannot pin one name here.
func stateCookie(t *testing.T, recorder *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()

	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Value == "" {
			continue
		}
		if cookie.Name == handler.StateCookieName(true) || cookie.Name == handler.StateCookieName(false) {
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

// sessionCookie returns the session cookie a response set, if any. Accepts
// either of the two possible names — see stateCookie for why.
func sessionCookie(recorder *httptest.ResponseRecorder) *http.Cookie {
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Value == "" {
			continue
		}
		if cookie.Name == middleware.SessionCookieName(true) || cookie.Name == middleware.SessionCookieName(false) {
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

	// AC-3 groundwork (issue #151 S3): a successful callback stamps
	// users.last_login_at, so the CRUD's "when did they last sign in?" column
	// has something to render. The value is the domain's clock (the fixture's
	// pinned `now`), matched exactly.
	if professor.LastLoginAt == nil {
		t.Fatalf("last_login_at is nil after a successful sign-in, want the fixture's clock (%v)", f.now)
	}
	if !professor.LastLoginAt.Equal(f.now) {
		t.Errorf("last_login_at = %v, want %v (the fixture's pinned now)", *professor.LastLoginAt, f.now)
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
	// __Host- requires Path=/ and no Domain. The Secure requirement is the
	// assertion two lines up.
	if cookie.Path != "/" {
		t.Errorf("Path = %q, want /", cookie.Path)
	}
	if cookie.Domain != "" {
		t.Errorf("Domain = %q, want empty (required by the __Host- prefix)", cookie.Domain)
	}
	if got, want := cookie.Name, "__Host-nalanda_oauth_state"; got != want {
		t.Errorf("Name = %q, want %q — the fixture is https, so the prefix must apply", got, want)
	}

	state, live := f.start(t)
	done := f.callback(t, state, "the-code", live)

	var cleared bool
	for _, c := range done.Result().Cookies() {
		if c.Name == handler.StateCookieName(true) && c.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Error("the state cookie survived the callback that spent it")
	}
}

// State-cookie names by literal — same shape as
// `middleware.TestSessionCookieNameCarriesHostPrefixInProductionAndNotInDev`
// and for the same reason: asking the function to answer its own question is
// circular.
func TestStateCookieNameCarriesHostPrefixInProductionAndNotInDev(t *testing.T) {
	if got, want := handler.StateCookieName(true), "__Host-nalanda_oauth_state"; got != want {
		t.Errorf("StateCookieName(true) = %q, want %q", got, want)
	}
	if got, want := handler.StateCookieName(false), "nalanda_oauth_state"; got != want {
		t.Errorf("StateCookieName(false) = %q, want %q", got, want)
	}
}

// SEC-4. The decision "the session's IP comes from RemoteAddr and NOT from
// X-Forwarded-For" was a comment and nothing else — mutation showed a line
// honouring the header could be added with the whole suite green. Nothing sits
// in front of this server by default, so that header is client-supplied.
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

// The other side of the same switch: the Jetson deploy (#162) puts Tailscale
// Funnel in front of this server, and RemoteAddr becomes 127.0.0.1 for every
// visitor. Under NALANDA_TRUST_PROXY_HEADERS=true the sessions table records
// the FIRST hop of X-Forwarded-For instead — the leftmost, which is what the
// outermost proxy first saw, not the rightmost (which is the one nearest us).
//
// This test travels with `TestTheSessionIPIgnoresAForgeableHeader` on purpose:
// each pins one arm of the same switch, and the pair proves the guard reads
// the flag at all — one alone would stay green if the switch stopped switching.
func TestTheSessionIPTrustsTheProxyHeaderWhenConfigured(t *testing.T) {
	f := newTrustProxyFixture(t, "profesora@example.com")
	state, stateCookie := f.start(t)

	target := handler.LoginCallbackPath + "?state=" + url.QueryEscape(state) + "&code=the-code"
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.AddCookie(stateCookie)
	// The shape Tailscale Funnel produces on the Jetson: the outermost proxy
	// wrote the visitor's public IP; RemoteAddr is loopback because the
	// tunnel completes on 127.0.0.1.
	request.Header.Set("X-Forwarded-For", "203.0.113.9, 100.64.0.1")
	request.RemoteAddr = "127.0.0.1:54321"

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

	if session.IPAddress == "127.0.0.1" {
		t.Error("the session recorded 127.0.0.1 — the proxy's peer address rather than the visitor's")
	}
	if session.IPAddress == "100.64.0.1" {
		t.Error("the session recorded the RIGHTMOST hop of X-Forwarded-For rather than the leftmost")
	}
	if session.IPAddress != "203.0.113.9" {
		t.Errorf("IPAddress = %q, want %q — the leftmost hop of X-Forwarded-For", session.IPAddress, "203.0.113.9")
	}
}

// SEC-2: the leftmost X-Forwarded-For entry is trusted as an ADDRESS at the
// seam — it is not enough that the header be present, its first hop must
// parse as an IP. The failure mode is that a header value like
// `<script>alert(1)</script>` (or 4 KB of garbage) reaches
// `user_sessions.ip_address` verbatim, and a future backoffice screen
// rendering the sessions table inherits an XSS or UI-truncation surface
// through a value the boundary never refused.
func TestTheSessionIPRejectsANonAddressLeftmostHop(t *testing.T) {
	for name, header := range map[string]string{
		"a script tag":              "<script>alert(1)</script>",
		"bare word":                 "definitely-not-an-ip",
		"empty leftmost with comma": ", 100.64.0.1",
	} {
		t.Run(name, func(t *testing.T) {
			f := newTrustProxyFixture(t, "profesora@example.com")
			state, stateCookie := f.start(t)

			target := handler.LoginCallbackPath + "?state=" + url.QueryEscape(state) + "&code=the-code"
			request := httptest.NewRequest(http.MethodGet, target, nil)
			request.AddCookie(stateCookie)
			request.Header.Set("X-Forwarded-For", header)
			request.RemoteAddr = "127.0.0.1:54321"

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

			if session.IPAddress != "127.0.0.1" {
				t.Errorf("IPAddress = %q, want the RemoteAddr fallback %q — a non-address X-Forwarded-For must not reach the sessions table", session.IPAddress, "127.0.0.1")
			}
		})
	}
}

// And a port-carrying leftmost hop is stripped rather than dropped — some
// proxies write `<addr>:<port>` and the port half is not part of the address.
// SEC-2 covers both directions: garbage in the port slot still refuses the
// row, an IP with a port keeps the address.
func TestTheSessionIPStripsThePortFromAProxyHopThatCarriesOne(t *testing.T) {
	for name, header := range map[string]string{
		"ipv4 with port": "203.0.113.9:12345",
		"ipv6 bracketed": "[2001:db8::1]:443",
	} {
		t.Run(name, func(t *testing.T) {
			f := newTrustProxyFixture(t, "profesora@example.com")
			state, stateCookie := f.start(t)

			target := handler.LoginCallbackPath + "?state=" + url.QueryEscape(state) + "&code=the-code"
			request := httptest.NewRequest(http.MethodGet, target, nil)
			request.AddCookie(stateCookie)
			request.Header.Set("X-Forwarded-For", header)
			request.RemoteAddr = "127.0.0.1:54321"

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

			// The port must be gone.
			if strings.ContainsAny(session.IPAddress, ":") && !strings.HasPrefix(session.IPAddress, "2001:") {
				// A bare IPv6 address has colons; a stripped IPv4 or bracketed IPv6 does not carry the :port.
				t.Errorf("IPAddress = %q; the port half of %q was not stripped", session.IPAddress, header)
			}
			if session.IPAddress == "127.0.0.1" {
				t.Errorf("IPAddress fell back to RemoteAddr; a well-formed hop with a port must NOT be treated as garbage")
			}
		})
	}
}

// And the fall-through: TrustProxyHeaders is on but the proxy did not send the
// header. Falling to RemoteAddr rather than emitting empty text is what makes a
// misconfigured proxy legible in the operator's table instead of losing the row.
func TestTheSessionIPFallsBackToRemoteAddrWhenTheHeaderIsAbsent(t *testing.T) {
	f := newTrustProxyFixture(t, "profesora@example.com")
	state, stateCookie := f.start(t)

	target := handler.LoginCallbackPath + "?state=" + url.QueryEscape(state) + "&code=the-code"
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.AddCookie(stateCookie)
	// No X-Forwarded-For at all.
	request.RemoteAddr = "127.0.0.1:54321"

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

	if session.IPAddress != "127.0.0.1" {
		t.Errorf("IPAddress = %q, want %q (RemoteAddr fallback)", session.IPAddress, "127.0.0.1")
	}
}

// The page carrying a professor's address and their CSRF token must not be
// cacheable or framable (SEC-3).
func TestTheRenderedPageCarriesItsSecurityHeaders(t *testing.T) {
	f := newFixture(t, "")

	recorder := httptest.NewRecorder()
	f.auth.LoginPage(recorder, httptest.NewRequest(http.MethodGet, handler.LoginPath, nil))

	// All five. It asserted three, and the two it left out were the two the
	// code's own comment argues hardest for — deleting them from view.go left
	// the whole suite green (#150 review, SEC-8).
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
}

// SEC-5: cookie tossing, the residual the security lens found in the SEC-1 fix.
//
// A double-submit cookie has one classic weakness. An attacker who can write on
// a sibling host of the same registrable domain — plausible on university
// hosting — plants their own nonce under a deeper Path. RFC 6265 §5.4 orders
// longer paths first, so `r.Cookie` returns THEIRS, the comparison succeeds
// against the attacker's state, and the victim ends up in the attacker's
// session: the original SEC-1 attack, restored through the fix for it.
//
// Refusing when more than one cookie of that name arrives is what closes it,
// and it works over http, which the __Host- prefix does not.
func TestACallbackCarryingTwoStateCookiesIsRefused(t *testing.T) {
	f := newFixture(t, "profesora@example.com")

	attackerState, attackerCookie := f.start(t)
	_, victimCookie := f.start(t)

	target := handler.LoginCallbackPath + "?state=" + url.QueryEscape(attackerState) + "&code=the-code"
	request := httptest.NewRequest(http.MethodGet, target, nil)
	// The order a browser produces when the attacker's cookie has the longer
	// Path: theirs first, the victim's own second.
	request.AddCookie(attackerCookie)
	request.AddCookie(victimCookie)

	recorder := httptest.NewRecorder()
	f.auth.LoginGoogleCallback(recorder, request)

	if sessionCookie(recorder) != nil {
		t.Error("a callback carrying two state cookies opened a session — cookie tossing works")
	}
	if f.provider.Exchanges() != 0 {
		t.Error("the code was exchanged for a request carrying two state cookies")
	}
}

// COR-11: the trailing slash `config.Load` newly accepts must not double up in
// the redirect URI. Google matches it character for character, so
// `https://host//login/google/callback` is the same 404-after-callback failure
// COR-4 was about, through the value the fix for COR-4 blessed.
func TestTheCallbackURIIsTheSameWhicheverWayThePublicURLIsSpelled(t *testing.T) {
	for _, base := range []string{"https://nalanda.test", "https://nalanda.test/"} {
		t.Run(base, func(t *testing.T) {
			f := newFixture(t, "")
			f.auth = handler.NewAuth(handler.Auth{
				Login:        auth.NewLogin(auth.Login{Users: f.store, Identities: f.store, Sessions: f.store, Now: time.Now, SessionTTL: time.Hour}),
				Provider:     f.provider,
				ProviderName: "google",
				State:        oauthstate.New(time.Minute, time.Now),
				PublicURL:    base,
				Log:          slog.New(slog.NewTextHandler(io.Discard, nil)),
			})

			recorder := httptest.NewRecorder()
			f.auth.LoginGoogle(recorder, httptest.NewRequest(http.MethodGet, handler.LoginGooglePath, nil))

			const want = "https://nalanda.test" + handler.LoginCallbackPath
			if got := f.provider.LastRedirectURI(); got != want {
				t.Errorf("redirect URI = %q, want %q", got, want)
			}
		})
	}
}

// ARQ-12: the constructor's refusals had no test, and the fixtures bypassed it.
// Both are fixed — the fixture above goes through NewAuth — and these pin the
// refusals themselves.
func TestNewAuthRefusesAnIncompleteSet(t *testing.T) {
	f := newFixture(t, "")

	complete := func() handler.Auth {
		return handler.Auth{
			Login:        auth.NewLogin(auth.Login{Users: f.store, Identities: f.store, Sessions: f.store, Now: time.Now, SessionTTL: time.Hour}),
			Provider:     &oidctest.Provider{},
			ProviderName: "google",
			State:        oauthstate.New(time.Minute, time.Now),
			PublicURL:    publicURL,
			Log:          slog.New(slog.NewTextHandler(io.Discard, nil)),
		}
	}

	for name, break_ := range map[string]func(*handler.Auth){
		"no login service": func(d *handler.Auth) { d.Login = nil },
		"no provider":      func(d *handler.Auth) { d.Provider = nil },
		"no provider name": func(d *handler.Auth) { d.ProviderName = "" },
		"no state store":   func(d *handler.Auth) { d.State = nil },
		"no public URL":    func(d *handler.Auth) { d.PublicURL = "" },
		"no logger":        func(d *handler.Auth) { d.Log = nil },
	} {
		t.Run(name, func(t *testing.T) {
			deps := complete()
			break_(&deps)

			defer func() {
				if recover() == nil {
					t.Error("NewAuth accepted the set; a forgotten dependency must fail at wiring time, " +
						"not as a nil dereference inside a request")
				}
			}()
			_ = handler.NewAuth(deps)
		})
	}

	// Non-vacuity: the complete set must NOT panic, or every case above would
	// pass on a constructor that refuses everything.
	if got := handler.NewAuth(complete()); got == nil {
		t.Error("NewAuth returned nil for a complete set")
	}
}

// The Secure attribute is DERIVED from the public URL and can no longer be
// forgotten into false — which is what the review found: deleting both wirings
// left the suite green while the session cookie shipped without Secure over
// https (#150 review, ARQ-10).
func TestTheCookieFlagFollowsThePublicURL(t *testing.T) {
	for base, wantSecure := range map[string]bool{
		"https://nalanda.test":  true,
		"http://127.0.0.1:8081": false,
	} {
		t.Run(base, func(t *testing.T) {
			f := newFixture(t, "")
			f.auth = handler.NewAuth(handler.Auth{
				Login:        auth.NewLogin(auth.Login{Users: f.store, Identities: f.store, Sessions: f.store, Now: time.Now, SessionTTL: time.Hour}),
				Provider:     f.provider,
				ProviderName: "google",
				State:        oauthstate.New(time.Minute, time.Now),
				PublicURL:    base,
				Log:          slog.New(slog.NewTextHandler(io.Discard, nil)),
			})

			recorder := httptest.NewRecorder()
			f.auth.LoginGoogle(recorder, httptest.NewRequest(http.MethodGet, handler.LoginGooglePath, nil))

			if got := stateCookie(t, recorder).Secure; got != wantSecure {
				t.Errorf("Secure = %v for %q, want %v", got, base, wantSecure)
			}
		})
	}
}

// SEC-2's fix rests on this branch, and the whole suite stayed green with it
// deleted — the same unkillable fail-closed branch class COR-1/2/3 were about,
// inside the fix for a different finding (#150 review, verifier).
func TestAFullStateStoreTellsTheVisitorToTryAgain(t *testing.T) {
	f := newFixture(t, "")

	// Fill it. Every call is one anonymous GET /login/google.
	for range oauthstate.DefaultMaxSize {
		if _, err := f.auth.State.Issue(); err != nil {
			t.Fatalf("filling the store: %v", err)
		}
	}

	recorder := httptest.NewRecorder()
	f.auth.LoginGoogle(recorder, httptest.NewRequest(http.MethodGet, handler.LoginGooglePath, nil))

	location := recorder.Header().Get("Location")
	if !strings.Contains(location, "ocupado") {
		t.Errorf("Location = %q, want the login page saying to try again — "+
			"a full store is a flood, not a broken server", location)
	}
	if len(recorder.Result().Cookies()) > 0 {
		t.Error("a refused attempt still set a state cookie")
	}

	// And the message reaches the page, rather than being a query parameter the
	// login page ignores.
	page := httptest.NewRecorder()
	f.auth.LoginPage(page, httptest.NewRequest(http.MethodGet, location, nil))
	if !strings.Contains(page.Body.String(), "demasiados intentos") {
		t.Errorf("the login page does not show the notice:\n%s", page.Body.String())
	}
}
