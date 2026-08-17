package oidc_test

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/infra/oidc"
)

// The shape of this file is the point. Every case starts from ONE valid fixture
// and breaks exactly one thing, so a case can never pass because a second thing
// was also wrong, and removing any single check in the verifier reddens exactly
// the case that encodes it (backend-code-style.md §Testing).
//
// What is being tested is a signature verifier written against a published JWKS,
// so the fixture runs a real RSA key and a real httptest provider rather than a
// mock: a mock of a signature check verifies nothing about the signature check.

const (
	testClientID = "client-id.apps.googleusercontent.com"
	testKeyID    = "test-key-1"
	testSubject  = "google-subject-1"
	testEmail    = "profesora@example.com"
)

// fixture is a stand-in Google: a token endpoint that returns a signed ID token
// and a JWKS endpoint that publishes the key it was signed with.
type fixture struct {
	t *testing.T

	key   *rsa.PrivateKey
	keyID string

	// claims is what the ID token carries. A case edits it before calling
	// Exchange.
	claims map[string]any
	// header is the JWT header, editable for the algorithm cases.
	header map[string]any
	// signWith overrides the signing key, for the case where the token is
	// signed by something the JWKS does not publish.
	signWith *rsa.PrivateKey

	// tokenStatus and tokenBody override the token endpoint's answer;
	// jwksStatus makes the key set unreachable.
	tokenStatus int
	tokenBody   string
	jwksStatus  int

	jwksRequests  atomic.Int64
	tokenRequests atomic.Int64

	server *httptest.Server
}

func newFixture(t *testing.T) *fixture {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generating the signing key: %v", err)
	}

	f := &fixture{
		t:     t,
		key:   key,
		keyID: testKeyID,
		header: map[string]any{
			"alg": "RS256",
			"kid": testKeyID,
			"typ": "JWT",
		},
		claims: map[string]any{
			"iss":            "https://accounts.google.com",
			"aud":            testClientID,
			"sub":            testSubject,
			"email":          testEmail,
			"email_verified": true,
			"exp":            time.Now().Add(time.Hour).Unix(),
			"iat":            time.Now().Add(-time.Minute).Unix(),
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		f.tokenRequests.Add(1)
		if f.tokenStatus != 0 {
			w.WriteHeader(f.tokenStatus)
			_, _ = w.Write([]byte(f.tokenBody))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		body := f.tokenBody
		if body == "" {
			body = `{"id_token":` + jsonString(f.signedToken()) + `}`
		}
		_, _ = w.Write([]byte(body))
	})
	mux.HandleFunc("GET /jwks", func(w http.ResponseWriter, r *http.Request) {
		f.jwksRequests.Add(1)
		if f.jwksStatus != 0 {
			w.WriteHeader(f.jwksStatus)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(f.jwksJSON()))
	})

	f.server = httptest.NewServer(mux)
	t.Cleanup(f.server.Close)
	return f
}

// jsonString quotes a string as a JSON value, so the fixture's token endpoint
// produces a body a decoder will accept whatever the token contains.
func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func (f *fixture) provider() *oidc.Google {
	f.t.Helper()

	return oidc.NewGoogle(oidc.GoogleConfig{
		ClientID:     testClientID,
		ClientSecret: "client-secret",
		Issuer:       "https://accounts.google.com",
		AuthURL:      f.server.URL + "/auth",
		TokenURL:     f.server.URL + "/token",
		JWKSURL:      f.server.URL + "/jwks",
		HTTPClient:   f.server.Client(),
	})
}

// signedToken builds the ID token from the current header and claims.
func (f *fixture) signedToken() string {
	f.t.Helper()

	encode := func(v any) string {
		raw, err := json.Marshal(v)
		if err != nil {
			f.t.Fatalf("encoding a jwt segment: %v", err)
		}
		return base64.RawURLEncoding.EncodeToString(raw)
	}

	signed := encode(f.header) + "." + encode(f.claims)

	key := f.key
	if f.signWith != nil {
		key = f.signWith
	}
	digest := sha256.Sum256([]byte(signed))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		f.t.Fatalf("signing the token: %v", err)
	}
	return signed + "." + base64.RawURLEncoding.EncodeToString(signature)
}

// jwksJSON publishes the fixture's public key under f.keyID.
func (f *fixture) jwksJSON() string {
	f.t.Helper()

	exponent := big.NewInt(int64(f.key.PublicKey.E)).Bytes()
	keys := map[string]any{"keys": []map[string]any{{
		"kid": f.keyID,
		"kty": "RSA",
		"alg": "RS256",
		"use": "sig",
		"n":   base64.RawURLEncoding.EncodeToString(f.key.PublicKey.N.Bytes()),
		"e":   base64.RawURLEncoding.EncodeToString(exponent),
	}}}
	raw, err := json.Marshal(keys)
	if err != nil {
		f.t.Fatalf("encoding the jwks: %v", err)
	}
	return string(raw)
}

func TestGoogleSatisfiesTheDomainInterface(t *testing.T) {
	var _ auth.OAuthProvider = (*oidc.Google)(nil)
}

// The happy path, which every case below is a single mutation of.
func TestExchangeReturnsTheVerifiedEmailAndSubject(t *testing.T) {
	f := newFixture(t)

	email, subject, err := f.provider().Exchange(context.Background(), "the-code", "https://nalanda.test/callback")
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if email != testEmail {
		t.Errorf("email = %q, want %q", email, testEmail)
	}
	if subject != testSubject {
		t.Errorf("subject = %q, want %q", subject, testSubject)
	}
}

// One case per claim the verifier checks. Each breaks the fixture in exactly one
// way, and each is what fails when its check is deleted from the verifier —
// which is the property that makes this table a guard rather than a description.
func TestExchangeRefusesATokenThatFailsAnyCheck(t *testing.T) {
	for _, c := range []struct {
		name   string
		breaks func(*fixture)
	}{
		{"an expired token", func(f *fixture) {
			f.claims["exp"] = time.Now().Add(-time.Minute).Unix()
		}},
		{"a token issued for another client", func(f *fixture) {
			f.claims["aud"] = "someone-else.apps.googleusercontent.com"
		}},
		{"a token from another issuer", func(f *fixture) {
			f.claims["iss"] = "https://evil.example.com"
		}},
		{"an unverified email address", func(f *fixture) {
			f.claims["email_verified"] = false
		}},
		{"no email claim", func(f *fixture) {
			delete(f.claims, "email")
		}},
		{"no subject claim", func(f *fixture) {
			delete(f.claims, "sub")
		}},
		{"a signature from a key the provider does not publish", func(f *fixture) {
			other, err := rsa.GenerateKey(rand.Reader, 2048)
			if err != nil {
				f.t.Fatalf("generating the impostor key: %v", err)
			}
			f.signWith = other
		}},
		{"a key id that is not published", func(f *fixture) {
			f.header["kid"] = "a-kid-nobody-published"
		}},
		{"an unsigned token", func(f *fixture) {
			f.header["alg"] = "none"
		}},
		{"a symmetric algorithm", func(f *fixture) {
			f.header["alg"] = "HS256"
		}},
		{"a malformed token", func(f *fixture) {
			f.tokenBody = `{"id_token":"not.a-jwt"}`
		}},
		{"a token endpoint that refuses", func(f *fixture) {
			f.tokenStatus = http.StatusBadRequest
			f.tokenBody = `{"error":"invalid_grant"}`
		}},
		{"a token response with no id_token", func(f *fixture) {
			f.tokenBody = `{"access_token":"irrelevant"}`
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := newFixture(t)
			c.breaks(f)

			email, subject, err := f.provider().Exchange(context.Background(), "the-code", "https://nalanda.test/callback")
			if err == nil {
				t.Fatalf("Exchange accepted it, returning (%q, %q); want an error", email, subject)
			}
			// Partial data is worse than none: a caller that ignores the error
			// would otherwise log in whoever the unverified token names.
			if email != "" || subject != "" {
				t.Errorf("Exchange returned (%q, %q) alongside its error, want empty strings", email, subject)
			}
		})
	}
}

// Google publishes its issuer both with and without the scheme, and a token
// carrying the bare form is legitimate. Rejecting it would refuse real logins.
func TestExchangeAcceptsGooglesOtherIssuerSpelling(t *testing.T) {
	f := newFixture(t)
	f.claims["iss"] = "accounts.google.com"

	if _, _, err := f.provider().Exchange(context.Background(), "the-code", "https://nalanda.test/callback"); err != nil {
		t.Errorf("Exchange refused the bare issuer spelling: %v", err)
	}
}

// The keys are fetched once and reused. Without the cache every login costs an
// extra round trip to Google, and a provider outage becomes a login outage
// sooner than it needs to.
func TestTheKeySetIsCachedBetweenExchanges(t *testing.T) {
	f := newFixture(t)
	provider := f.provider()

	for range 3 {
		if _, _, err := provider.Exchange(context.Background(), "the-code", "https://nalanda.test/callback"); err != nil {
			t.Fatalf("Exchange: %v", err)
		}
	}

	if got := f.jwksRequests.Load(); got != 1 {
		t.Errorf("the key set was fetched %d times for 3 logins, want 1", got)
	}
	if got := f.tokenRequests.Load(); got != 3 {
		t.Errorf("the token endpoint was called %d times for 3 logins, want 3", got)
	}
}

// A cached key set must not outlive a key rotation: Google rotates, and a
// provider that answered "unknown kid" from cache would lock every professor out
// until the process restarted.
func TestAnUnknownKeyIdRefetchesTheKeySet(t *testing.T) {
	f := newFixture(t)
	provider := f.provider()

	if _, _, err := provider.Exchange(context.Background(), "the-code", "https://nalanda.test/callback"); err != nil {
		t.Fatalf("first Exchange: %v", err)
	}

	// Google rotates: a new key, published under a new id, signing from now on.
	rotated, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generating the rotated key: %v", err)
	}
	f.key = rotated
	f.keyID = "test-key-2"
	f.header["kid"] = "test-key-2"

	if _, _, err := provider.Exchange(context.Background(), "the-code", "https://nalanda.test/callback"); err != nil {
		t.Errorf("Exchange after a key rotation: %v", err)
	}
	if got := f.jwksRequests.Load(); got != 2 {
		t.Errorf("the key set was fetched %d times across a rotation, want 2", got)
	}
}

func TestAuthCodeURLCarriesWhatTheProviderNeeds(t *testing.T) {
	f := newFixture(t)
	const redirect = "https://nalanda.test/login/google/callback"

	raw := f.provider().AuthCodeURL("the-state-nonce", redirect)

	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parsing the authorization URL %q: %v", raw, err)
	}
	if !strings.HasPrefix(raw, f.server.URL+"/auth?") {
		t.Errorf("the URL points at %q, want the configured authorization endpoint", raw)
	}

	query := parsed.Query()
	for _, c := range []struct{ key, want string }{
		{"client_id", testClientID},
		{"redirect_uri", redirect},
		{"response_type", "code"},
		{"state", "the-state-nonce"},
	} {
		if got := query.Get(c.key); got != c.want {
			t.Errorf("%s = %q, want %q", c.key, got, c.want)
		}
	}

	// openid is what makes this OIDC rather than bare OAuth — without it Google
	// returns no ID token at all and there is nothing to verify.
	scope := query.Get("scope")
	if !strings.Contains(scope, "openid") || !strings.Contains(scope, "email") {
		t.Errorf("scope = %q, want it to request at least openid and email", scope)
	}

	// The secret belongs to the back channel. In the authorization URL it would
	// travel through the professor's browser and into their history.
	if strings.Contains(raw, "client-secret") {
		t.Errorf("the authorization URL carries the client secret: %q", raw)
	}
}

// The secret is sent to the token endpoint and must appear nowhere else — not in
// an error, which is the path most likely to be logged.
func TestAFailingExchangeDoesNotLeakTheClientSecret(t *testing.T) {
	f := newFixture(t)
	f.tokenStatus = http.StatusBadRequest
	// A provider that echoed the request back is the worst realistic case.
	f.tokenBody = `{"error":"invalid_client","request":{"client_secret":"client-secret"}}`

	_, _, err := f.provider().Exchange(context.Background(), "the-code", "https://nalanda.test/callback")
	if err == nil {
		t.Fatal("Exchange succeeded against a refusing token endpoint")
	}
	if strings.Contains(err.Error(), "client-secret") {
		t.Errorf("the error carries the client secret: %v", err)
	}
}

// COR-7. Once the cache lapses, a provider outage must not become a login
// outage: Google rotates its keys on the order of days, so the key it published
// an hour ago is almost certainly still valid, and refusing every professor for
// the duration of somebody else's incident is the worse failure.
func TestALapsedCacheSurvivesAProviderOutage(t *testing.T) {
	f := newFixture(t)
	now := time.Now()
	provider := oidc.NewGoogle(oidc.GoogleConfig{
		ClientID:     testClientID,
		ClientSecret: "client-secret",
		Issuer:       "https://accounts.google.com",
		AuthURL:      f.server.URL + "/auth",
		TokenURL:     f.server.URL + "/token",
		JWKSURL:      f.server.URL + "/jwks",
		HTTPClient:   f.server.Client(),
		Now:          func() time.Time { return now },
		JWKSCacheTTL: time.Hour,
	})

	if _, _, err := provider.Exchange(context.Background(), "the-code", "https://nalanda.test/callback"); err != nil {
		t.Fatalf("warming the cache: %v", err)
	}

	// The cache lapses, and the key set stops answering. The token is reissued
	// with a live exp, so the only thing under test is the unreachable key set.
	now = now.Add(2 * time.Hour)
	f.claims["exp"] = now.Add(time.Hour).Unix()
	f.jwksStatus = http.StatusInternalServerError

	if _, _, err := provider.Exchange(context.Background(), "the-code", "https://nalanda.test/callback"); err != nil {
		t.Errorf("a login was refused because the key set was unreachable: %v", err)
	}
}

// The boundary of the token's own expiry, which the session's IsExpired pins and
// this did not: a token is expired AT its exp, not one second later.
func TestATokenExpiringExactlyNowIsRefused(t *testing.T) {
	f := newFixture(t)
	now := time.Now().Truncate(time.Second)
	f.claims["exp"] = now.Unix()

	provider := oidc.NewGoogle(oidc.GoogleConfig{
		ClientID:     testClientID,
		ClientSecret: "client-secret",
		Issuer:       "https://accounts.google.com",
		AuthURL:      f.server.URL + "/auth",
		TokenURL:     f.server.URL + "/token",
		JWKSURL:      f.server.URL + "/jwks",
		HTTPClient:   f.server.Client(),
		Now:          func() time.Time { return now },
	})

	if _, _, err := provider.Exchange(context.Background(), "the-code", "https://nalanda.test/callback"); err == nil {
		t.Error("a token expiring exactly now was accepted")
	}
}
