package oidc_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	domaingmail "github.com/so77id/nalanda/apps/server/internal/domain/gmail"
	"github.com/so77id/nalanda/apps/server/internal/infra/oidc"
)

// The Gmail authorisation is a SECOND flow against the same Google client,
// and everything that makes it different from the login is a parameter that
// fails silently when it is wrong:
//
//   - without access_type=offline Google returns no refresh token, the
//     connection looks complete, and every publication weeks later fails
//     with nothing stored to refresh;
//   - without prompt=consent a professor who already granted the scope gets
//     a response with no refresh token, which is the same failure reached a
//     different way;
//   - with the login's scopes the token is issued and Gmail refuses every
//     send with 403.
//
// None of the three is visible until a real send, so each is pinned here.

func (f *fixture) gmailAuthorizer() *oidc.GmailAuthorizer {
	f.t.Helper()

	return oidc.NewGmailAuthorizer(oidc.GoogleConfig{
		ClientID:     testClientID,
		ClientSecret: "client-secret",
		Issuer:       "https://accounts.google.com",
		AuthURL:      f.server.URL + "/auth",
		TokenURL:     f.server.URL + "/token",
		JWKSURL:      f.server.URL + "/jwks",
		HTTPClient:   f.server.Client(),
	})
}

func TestGmailAuthorizerSatisfiesTheDomainPort(t *testing.T) {
	f := newFixture(t)
	var _ domaingmail.Authorizer = f.gmailAuthorizer()
}

func TestGmailAuthCodeURLAsksForOfflineConsentOnTheSendScope(t *testing.T) {
	f := newFixture(t)

	raw := f.gmailAuthorizer().AuthCodeURL("nonce-123", "https://nalanda.test/profile/gmail/callback")
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("the authorizer built an unparseable URL %q: %v", raw, err)
	}
	q := parsed.Query()

	if got := q.Get("access_type"); got != "offline" {
		t.Errorf("access_type = %q, want \"offline\" — without it Google returns no refresh token "+
			"and the connection is dead the moment the browser closes", got)
	}
	if got := q.Get("prompt"); got != "consent" {
		t.Errorf("prompt = %q, want \"consent\" — a professor who already granted this scope "+
			"otherwise gets a response with no refresh token", got)
	}

	scopes := strings.Fields(q.Get("scope"))
	if !contains(scopes, domaingmail.Scope) {
		t.Errorf("scope %q does not include %q; the token would be issued and every send refused",
			q.Get("scope"), domaingmail.Scope)
	}
	// `openid email` rides along so the exchange names WHICH account was
	// connected. Without it the server would have to guess that the
	// connected account equals the login account, which it is allowed not
	// to be.
	if !contains(scopes, "openid") || !contains(scopes, "email") {
		t.Errorf("scope %q lacks openid/email; the exchange would not name the connected address",
			q.Get("scope"))
	}
	// The login asks for `profile`; this flow has no use for a display
	// name and must not ask for more than it needs.
	if contains(scopes, "profile") {
		t.Errorf("scope %q asks for `profile`, which this flow never reads", q.Get("scope"))
	}

	if got := q.Get("state"); got != "nonce-123" {
		t.Errorf("state = %q, want the nonce it was handed", got)
	}
	if got := q.Get("redirect_uri"); got != "https://nalanda.test/profile/gmail/callback" {
		t.Errorf("redirect_uri = %q, want the one it was handed", got)
	}
	if got := q.Get("response_type"); got != "code" {
		t.Errorf("response_type = %q, want \"code\"", got)
	}
	if q.Get("client_secret") != "" {
		t.Error("the consent URL carries the client secret; it travels through the professor's " +
			"browser and into their history")
	}
}

func TestGmailExchangeReturnsTheRefreshTokenAndTheConnectedAddress(t *testing.T) {
	f := newFixture(t)
	f.tokenBody = `{"refresh_token":"1//refresh-abc","access_token":"ya29.access","expires_in":3599,` +
		`"id_token":` + jsonString(f.signedToken()) + `}`

	grant, err := f.gmailAuthorizer().Exchange(context.Background(), "code-1", "https://nalanda.test/cb")
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if grant.RefreshToken != "1//refresh-abc" {
		t.Errorf("RefreshToken = %q, want the one the provider returned", grant.RefreshToken)
	}
	if grant.Address != testEmail {
		t.Errorf("Address = %q, want %q from the verified ID token", grant.Address, testEmail)
	}
	if grant.Access.Token != "ya29.access" {
		t.Errorf("Access.Token = %q, want the one the provider returned", grant.Access.Token)
	}
	// expires_in is seconds from now, so the expiry must land in the
	// future and roughly where the provider said. A zero expiry would make
	// Access.Valid false forever and spend a refresh on every single send.
	if !grant.Access.Valid(time.Now()) {
		t.Errorf("the access token from a fresh exchange is already invalid; expiry = %v", grant.Access.Expiry)
	}
}

// The failure this test exists for is the silent one: a consent that comes
// back with an id_token and no refresh_token looks like success everywhere
// except weeks later, at the first publication.
func TestGmailExchangeRefusesAConsentThatCarriesNoRefreshToken(t *testing.T) {
	f := newFixture(t)
	f.tokenBody = `{"access_token":"ya29.access","expires_in":3599,` +
		`"id_token":` + jsonString(f.signedToken()) + `}`

	_, err := f.gmailAuthorizer().Exchange(context.Background(), "code-1", "https://nalanda.test/cb")
	if !errors.Is(err, domaingmail.ErrNoRefreshToken) {
		t.Fatalf("Exchange returned %v, want ErrNoRefreshToken", err)
	}
}

func TestGmailExchangeVerifiesTheIDTokenRatherThanReadingIt(t *testing.T) {
	f := newFixture(t)
	// Signed by a key the JWKS does not publish. A reader that merely
	// decoded the payload would happily report the address inside it.
	f.signWith = otherKey(t)
	f.tokenBody = `{"refresh_token":"1//refresh-abc","access_token":"ya29.access","expires_in":3599,` +
		`"id_token":` + jsonString(f.signedToken()) + `}`

	grant, err := f.gmailAuthorizer().Exchange(context.Background(), "code-1", "https://nalanda.test/cb")
	if err == nil {
		t.Fatalf("Exchange accepted a token signed by an unpublished key and returned %+v", grant)
	}
	if grant.RefreshToken != "" || grant.Address != "" {
		t.Errorf("a failed Exchange returned %+v, want the zero value — partial data lets a caller "+
			"that mishandles the error connect whoever the unverified token names", grant)
	}
}

func TestGmailRefreshReturnsAFreshAccessToken(t *testing.T) {
	f := newFixture(t)
	f.tokenBody = `{"access_token":"ya29.fresh","expires_in":3599,"token_type":"Bearer"}`

	access, err := f.gmailAuthorizer().Refresh(context.Background(), "1//refresh-abc")
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if access.Token != "ya29.fresh" {
		t.Errorf("Token = %q, want the refreshed one", access.Token)
	}
	if !access.Valid(time.Now()) {
		t.Errorf("the refreshed token is already invalid; expiry = %v", access.Expiry)
	}
}

// invalid_grant is the one failure that must be told apart from every
// other, because it is the only one that justifies deleting the stored
// credential. Folding it into a generic error would either make a professor
// reconnect after every outage, or leave a revoked credential looking
// healthy forever.
func TestGmailRefreshDistinguishesARejectedCredentialFromAnOutage(t *testing.T) {
	t.Run("invalid_grant is a rejection", func(t *testing.T) {
		f := newFixture(t)
		f.tokenStatus = 400
		f.tokenBody = `{"error":"invalid_grant","error_description":"Token has been expired or revoked."}`

		_, err := f.gmailAuthorizer().Refresh(context.Background(), "1//dead")
		if !errors.Is(err, domaingmail.ErrRejected) {
			t.Fatalf("Refresh returned %v, want ErrRejected", err)
		}
	})

	t.Run("a 5xx is an outage", func(t *testing.T) {
		f := newFixture(t)
		f.tokenStatus = 503
		f.tokenBody = `{"error":"backend_error"}`

		_, err := f.gmailAuthorizer().Refresh(context.Background(), "1//alive")
		if !errors.Is(err, domaingmail.ErrUnavailable) {
			t.Fatalf("Refresh returned %v, want ErrUnavailable — an outage must never delete a "+
				"working credential", err)
		}
		if errors.Is(err, domaingmail.ErrRejected) {
			t.Error("a 503 was reported as a rejected credential")
		}
	})

	t.Run("a 400 that is not invalid_grant is not a rejection", func(t *testing.T) {
		f := newFixture(t)
		f.tokenStatus = 400
		f.tokenBody = `{"error":"invalid_request"}`

		_, err := f.gmailAuthorizer().Refresh(context.Background(), "1//alive")
		if errors.Is(err, domaingmail.ErrRejected) {
			t.Error("invalid_request was reported as a rejected credential; the credential is fine " +
				"and this server built a bad request")
		}
	})
}

// The same rule internal/infra/canvas holds to, one credential over: an
// error string reaches stderr and stderr reaches whatever collects
// container logs.
func TestNoGmailErrorEverCarriesACredential(t *testing.T) {
	const (
		secret  = "client-secret"
		refresh = "1//refresh-abc"
	)

	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"a rejection", 400, `{"error":"invalid_grant"}`},
		{"an outage", 503, `{"error":"backend_error"}`},
		{"a body that does not parse", 400, `<html>no</html>`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture(t)
			f.tokenStatus = tc.status
			f.tokenBody = tc.body

			_, err := f.gmailAuthorizer().Refresh(context.Background(), refresh)
			if err == nil {
				t.Fatal("want an error")
			}
			if strings.Contains(err.Error(), refresh) {
				t.Errorf("the error carries the refresh token: %v", err)
			}
			if strings.Contains(err.Error(), secret) {
				t.Errorf("the error carries the client secret: %v", err)
			}
		})
	}
}

// otherKey is a signing key the fixture's JWKS does not publish.
func otherKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generating an unpublished key: %v", err)
	}
	return key
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}
