package handler_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/gmail"
	"github.com/so77id/nalanda/apps/server/internal/domain/secret"
)

// The Gmail connection is a SECOND OAuth flow reaching a server that
// already has one, and the cases that matter are the ones about keeping
// them apart. A nonce or a cookie shared between the two would let a
// callback issued for one grant complete the other, and the two grants
// carry different scopes — so the confusion would hand a login the send
// permission, or a connection a session.

// gmailCallback drives the callback the way Google does: a GET carrying
// `state` and `code`, with the session cookie the professor already holds
// and whatever state cookie the case wants to present.
func (f *profileFixture) gmailCallback(t *testing.T, session, state string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()

	target := handler.ProfileGmailCallbackPath + "?state=" + url.QueryEscape(state) + "&code=code-1"
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.AddCookie(&http.Cookie{Name: middleware.SessionCookieName(true), Value: session})
	for _, c := range cookies {
		request.AddCookie(c)
	}
	recorder := httptest.NewRecorder()
	f.middleware.Resolve(
		f.middleware.RequireProfessor(http.HandlerFunc(f.handler.GmailCallback)),
	).ServeHTTP(recorder, request)
	return recorder
}

// stateCookieFrom pulls the nonce the connect leg planted, so a case can
// present it back the way a browser would.
func stateCookieFrom(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()

	for _, c := range rec.Result().Cookies() {
		if c.Name == handler.GmailStateCookieName(true) && c.Value != "" {
			return c
		}
	}
	t.Fatal("the connect leg planted no state cookie; the callback has nothing to verify against")
	return nil
}

// startConnect runs the connect leg and returns the planted cookie.
func (f *profileFixture) startConnect(t *testing.T, session string) *http.Cookie {
	t.Helper()

	rec := f.post(t, session, handler.ProfileGmailConnectPath, f.handler.ConnectGmail, url.Values{})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("connect status = %d, want 303", rec.Code)
	}
	if got := rec.Header().Get("Location"); !strings.Contains(got, "provider.test") {
		t.Fatalf("connect redirected to %q, want the provider's consent screen", got)
	}
	return stateCookieFrom(t, rec)
}

func TestTheProfilePageInvitesAConnectionWhenThereIsNone(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)

	body := f.get(t, session).Body.String()
	if !strings.Contains(body, handler.ProfileGmailConnectPath) {
		t.Errorf("the page offers no way to connect Gmail (no %s)", handler.ProfileGmailConnectPath)
	}
	if strings.Contains(body, handler.ProfileGmailDisconnectPath) {
		t.Error("the page offers Desconectar with nothing connected")
	}
}

// The happy path, end to end through the real sealing and the real users
// table: consent completes, the token is sealed, the address is stamped,
// and the next GET names the account.
func TestCompletingTheConsentConnectsTheAccountAndTheNextPageNamesIt(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	user, session := f.signIn(t)
	f.gmailAuth.grant = gmail.Grant{
		RefreshToken: "1//refresh-abc",
		Address:      "profesora.personal@gmail.com",
	}

	cookie := f.startConnect(t, session)
	rec := f.gmailCallback(t, session, cookie.Value, cookie)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("callback status = %d, want 303", rec.Code)
	}

	stored, err := f.secrets.Get(context.Background(), user.ID, secret.NamespaceGmail, secret.KeyRefreshToken)
	if err != nil {
		t.Fatalf("the refresh token was not sealed: %v", err)
	}
	if stored != "1//refresh-abc" {
		t.Errorf("the sealed token is %q", stored)
	}

	body := f.get(t, session).Body.String()
	if !strings.Contains(body, "profesora.personal@gmail.com") {
		t.Error("the page does not name the connected account; a professor who picked the wrong " +
			"one has no way to notice")
	}
	if !strings.Contains(body, handler.ProfileGmailDisconnectPath) {
		t.Error("the page offers no way to disconnect")
	}
	if strings.Contains(body, `action="`+handler.ProfileGmailConnectPath+`"`) {
		t.Error("the page still offers Conectar beside a connected account")
	}
}

// The redirect URI Google matches character for character. Both legs must
// send the same one, and it must be built from the configured public URL —
// not from the request's Host, which a caller chooses.
func TestBothLegsSendTheSameRedirectURI(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.gmailAuth.grant = gmail.Grant{RefreshToken: "1//r", Address: "profesora@gmail.com"}

	cookie := f.startConnect(t, session)
	consentURI := f.gmailAuth.lastRedirectURI

	f.gmailCallback(t, session, cookie.Value, cookie)
	if f.gmailAuth.lastRedirectURI != consentURI {
		t.Errorf("the consent sent %q and the exchange sent %q; Google refuses the pair",
			consentURI, f.gmailAuth.lastRedirectURI)
	}
	if want := publicURL + handler.ProfileGmailCallbackPath; consentURI != want {
		t.Errorf("redirect URI = %q, want %q built from the configured public URL", consentURI, want)
	}
}

// AC3, first direction. The two flows keep separate cookies and separate
// nonce stores, and this is what that buys: a nonce the LOGIN issued
// cannot complete a Gmail connection.
func TestALoginNonceCannotCompleteAGmailConnection(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	user, session := f.signIn(t)
	f.gmailAuth.grant = gmail.Grant{RefreshToken: "1//r", Address: "profesora@gmail.com"}

	// A nonce shaped exactly like a real one, presented under the LOGIN's
	// cookie name. The Gmail callback reads its own name, finds nothing,
	// and must refuse before reaching the provider.
	rec := f.gmailCallback(t, session, "some-login-nonce", &http.Cookie{
		Name:  handler.StateCookieName(true),
		Value: "some-login-nonce",
	})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want a 303 back to the profile", rec.Code)
	}
	if f.gmailAuth.exchanges != 0 {
		t.Error("the callback reached the provider with a nonce this flow never issued")
	}
	if _, err := f.secrets.Get(context.Background(), user.ID, secret.NamespaceGmail, secret.KeyRefreshToken); err == nil {
		t.Error("a credential was stored from a callback this flow never started")
	}
}

// AC3, and the cookie-tossing half. An attacker who can write on a sibling
// host plants a second cookie of the same name under a deeper Path; RFC
// 6265 §5.4 orders longer paths first, so a handler reading r.Cookie would
// get theirs. Refusing when the count is not exactly one is what closes
// it, and it works over http — which the __Host- prefix does not.
func TestAGmailCallbackWithTwoStateCookiesIsRefused(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.gmailAuth.grant = gmail.Grant{RefreshToken: "1//r", Address: "profesora@gmail.com"}

	cookie := f.startConnect(t, session)
	planted := &http.Cookie{Name: handler.GmailStateCookieName(true), Value: "attacker-nonce"}

	rec := f.gmailCallback(t, session, cookie.Value, planted, cookie)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want a 303 back to the profile", rec.Code)
	}
	if f.gmailAuth.exchanges != 0 {
		t.Error("the callback reached the provider although two state cookies were presented")
	}
}

// A nonce is spent whatever the outcome. Replaying the same callback must
// not connect a second time.
func TestAGmailCallbackCannotBeReplayed(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.gmailAuth.grant = gmail.Grant{RefreshToken: "1//r", Address: "profesora@gmail.com"}

	cookie := f.startConnect(t, session)
	if rec := f.gmailCallback(t, session, cookie.Value, cookie); rec.Code != http.StatusSeeOther {
		t.Fatalf("first callback status = %d", rec.Code)
	}
	if f.gmailAuth.exchanges != 1 {
		t.Fatalf("the first callback made %d exchanges, want 1", f.gmailAuth.exchanges)
	}

	f.gmailCallback(t, session, cookie.Value, cookie)
	if f.gmailAuth.exchanges != 1 {
		t.Errorf("a replayed callback made a second exchange (%d total); the nonce is not single-use",
			f.gmailAuth.exchanges)
	}
}

// Every exit clears the cookie, successful or not. Leaving a spent nonce
// in the browser only invites the replay above.
func TestTheGmailStateCookieIsClearedOnEveryExit(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.gmailAuth.grant = gmail.Grant{RefreshToken: "1//r", Address: "profesora@gmail.com"}

	cookie := f.startConnect(t, session)
	for _, tc := range []struct {
		name  string
		state string
	}{
		{"a completed connection", cookie.Value},
		{"a refused one", "not-the-nonce"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := f.gmailCallback(t, session, tc.state, cookie)
			cleared := false
			for _, c := range rec.Result().Cookies() {
				if c.Name == handler.GmailStateCookieName(true) && c.MaxAge < 0 {
					cleared = true
				}
			}
			if !cleared {
				t.Error("the state cookie was not cleared")
			}
		})
	}
}

// The professor pressed "Cancelar". An ordinary answer: say so, store
// nothing, and leave the button where it was.
func TestARefusedConsentStoresNothingAndSaysSo(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	user, session := f.signIn(t)

	cookie := f.startConnect(t, session)
	target := handler.ProfileGmailCallbackPath +
		"?state=" + url.QueryEscape(cookie.Value) + "&error=access_denied"
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.AddCookie(&http.Cookie{Name: middleware.SessionCookieName(true), Value: session})
	request.AddCookie(cookie)
	rec := httptest.NewRecorder()
	f.middleware.Resolve(
		f.middleware.RequireProfessor(http.HandlerFunc(f.handler.GmailCallback)),
	).ServeHTTP(rec, request)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", rec.Code)
	}
	if f.gmailAuth.exchanges != 0 {
		t.Error("a callback carrying no code still reached the provider")
	}
	if _, err := f.secrets.Get(context.Background(), user.ID, secret.NamespaceGmail, secret.KeyRefreshToken); err == nil {
		t.Error("a refused consent stored a credential")
	}
}

// The failure whose message has to explain something the professor cannot
// see: Google withheld the long-lived half, and the repair is on Google's
// own permissions page.
func TestAConsentWithNoRefreshTokenExplainsTheRepair(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	user, session := f.signIn(t)
	f.gmailAuth.exchange = gmail.ErrNoRefreshToken

	cookie := f.startConnect(t, session)
	rec := f.gmailCallback(t, session, cookie.Value, cookie)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", rec.Code)
	}
	if _, err := f.secrets.Get(context.Background(), user.ID, secret.NamespaceGmail, secret.KeyRefreshToken); err == nil {
		t.Error("a consent with no refresh token stored something")
	}

	// The flash COOKIE, not the next page's body: a body scrape is coupled
	// to the layout that renders the flash and breaks on a <p> ↔ <ul>
	// transition, and decoding the cookie tests the handler's own output
	// (testing-strategy.md §apps/server).
	//
	// The professor is told where to go, because nothing on this page can
	// fix it for them.
	message := flashFromResponse(t, rec)
	if !strings.Contains(message, "permisos") {
		t.Errorf("the message %q does not point at the account's permissions page, "+
			"which is the only repair", message)
	}
}

func TestDisconnectingRemovesBothHalvesAndOffersToConnectAgain(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	user, session := f.signIn(t)
	f.gmailAuth.grant = gmail.Grant{RefreshToken: "1//r", Address: "profesora@gmail.com"}

	cookie := f.startConnect(t, session)
	f.gmailCallback(t, session, cookie.Value, cookie)

	rec := f.post(t, session, handler.ProfileGmailDisconnectPath, f.handler.DisconnectGmail, url.Values{})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("disconnect status = %d, want 303", rec.Code)
	}

	if _, err := f.secrets.Get(context.Background(), user.ID, secret.NamespaceGmail, secret.KeyRefreshToken); err == nil {
		t.Error("the sealed token survived the disconnect")
	}
	address, err := f.store.GmailAddress(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("GmailAddress: %v", err)
	}
	if address != "" {
		t.Errorf("the address survived at %q", address)
	}

	body := f.get(t, session).Body.String()
	if !strings.Contains(body, handler.ProfileGmailConnectPath) {
		t.Error("the page does not offer to connect again")
	}
}

// A deployment with no master key can store no credential of any kind. It
// must still boot and still render — the same state, and the same
// handling, as the Canvas integration one section up.
func TestTheGmailSectionSurvivesADeploymentWithNoMasterKey(t *testing.T) {
	f := newProfileFixture(t, nil)
	_, session := f.signIn(t)

	rec := f.get(t, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want the page to render", rec.Code)
	}
}

func TestGmailStateCookieCarriesTheHostPrefixInProductionAndNotInDev(t *testing.T) {
	if got := handler.GmailStateCookieName(true); got != "__Host-nalanda_gmail_state" {
		t.Errorf("production name = %q", got)
	}
	if got := handler.GmailStateCookieName(false); got != "nalanda_gmail_state" {
		t.Errorf("development name = %q", got)
	}
	// And it is NOT the login's, which is the whole of AC3's mechanism.
	if handler.GmailStateCookieName(true) == handler.StateCookieName(true) {
		t.Error("the two flows share a state cookie name; a nonce issued for one could be spent on the other")
	}
}
