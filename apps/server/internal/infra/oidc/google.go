// Package oidc is the Google side of the professor login: the authorization-code
// flow of ADR-0009, with the ID token verified here rather than trusted.
//
// It is written against the standard library — crypto/rsa over the JWKS Google
// publishes — and not against an OIDC client library, which is a decision worth
// stating because the opposite is the usual one. Ported from DocumentBuddy,
// where it has run in production since its WP22, it means the whole professor
// auth system costs this repository no dependency at all: go.mod's direct block
// stays at modernc.org/sqlite and goose, and the supply chain of a login path
// stays something one can read in an afternoon.
//
// What the package does NOT do is equally deliberate: no refresh tokens (a
// professor logs in again), no userinfo endpoint (the ID token already carries
// the two claims that matter), and no nonce claim — the callback is tied to the
// attempt by the state nonce the delivery surface holds, which is also what
// defends the CSRF of the callback itself.
package oidc

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
)

// Google's production endpoints, and the cache lifetime of its key set. Defaults
// rather than configuration: a test overrides them with an httptest server, and
// nothing else has a reason to.
const (
	defaultIssuer       = "https://accounts.google.com"
	defaultAuthURL      = "https://accounts.google.com/o/oauth2/v2/auth"
	defaultTokenURL     = "https://oauth2.googleapis.com/token"
	defaultJWKSURL      = "https://www.googleapis.com/oauth2/v3/certs"
	defaultJWKSCacheTTL = time.Hour
	defaultHTTPTimeout  = 10 * time.Second
)

// providerName is what an identity from this package is stored under. It is the
// provider half of the (provider, subject) login key.
const providerName = "google"

// GoogleConfig configures Google. ClientID and ClientSecret are required;
// everything else has a working default.
type GoogleConfig struct {
	ClientID     string
	ClientSecret string

	Issuer       string
	AuthURL      string
	TokenURL     string
	JWKSURL      string
	HTTPClient   *http.Client
	Now          func() time.Time
	JWKSCacheTTL time.Duration
}

// Google implements auth.OAuthProvider against Google's authorization-code flow.
type Google struct {
	cfg  GoogleConfig
	jwks jwksCache
}

// jwksCache holds the key set and the moment it was fetched.
type jwksCache struct {
	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	fetched time.Time
}

// NewGoogle returns a provider with the defaults filled in.
func NewGoogle(cfg GoogleConfig) *Google {
	if cfg.Issuer == "" {
		cfg.Issuer = defaultIssuer
	}
	if cfg.AuthURL == "" {
		cfg.AuthURL = defaultAuthURL
	}
	if cfg.TokenURL == "" {
		cfg.TokenURL = defaultTokenURL
	}
	if cfg.JWKSURL == "" {
		cfg.JWKSURL = defaultJWKSURL
	}
	if cfg.HTTPClient == nil {
		// A timeout, because the default client has none: without it a provider
		// that accepts the connection and then stops talking holds a request
		// goroutine for as long as it likes.
		cfg.HTTPClient = &http.Client{Timeout: defaultHTTPTimeout}
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.JWKSCacheTTL == 0 {
		cfg.JWKSCacheTTL = defaultJWKSCacheTTL
	}
	return &Google{cfg: cfg}
}

var _ auth.OAuthProvider = (*Google)(nil)

// Provider returns the name identities from here are stored under, so that the
// delivery surface and the store agree on the string without either spelling it
// out.
func Provider() string { return providerName }

// AuthCodeURL builds the URL the browser is sent to. The client secret is not
// among the parameters and must never be: this URL travels through the
// professor's browser and into their history.
func (g *Google) AuthCodeURL(state, redirectURI string) string {
	query := url.Values{}
	query.Set("client_id", g.cfg.ClientID)
	query.Set("redirect_uri", redirectURI)
	query.Set("response_type", "code")
	// openid is what makes this OIDC rather than bare OAuth: without it Google
	// returns no ID token and there is nothing to verify.
	query.Set("scope", "openid email profile")
	query.Set("state", state)
	// select_account, because the professor's browser is usually already signed
	// into a personal Google account and silently reusing it is how someone logs
	// in as the wrong person without noticing.
	query.Set("prompt", "select_account")

	return g.cfg.AuthURL + "?" + query.Encode()
}

// Exchange completes the callback: the code is exchanged for an ID token at the
// token endpoint, and the ID token is then verified before a single claim from
// it is believed.
//
// On any failure it returns empty strings alongside the error. Partial data
// would let a caller that mishandles the error log in whoever an unverified
// token happens to name.
func (g *Google) Exchange(ctx context.Context, code, redirectURI string) (string, string, error) {
	idToken, err := g.exchangeCode(ctx, code, redirectURI)
	if err != nil {
		return "", "", err
	}
	return g.verifyIDToken(ctx, idToken)
}

// exchangeCode trades the authorization code for the ID token, over the back
// channel, where the client secret belongs.
func (g *Google) exchangeCode(ctx context.Context, code, redirectURI string) (string, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", g.cfg.ClientID)
	form.Set("client_secret", g.cfg.ClientSecret)
	form.Set("redirect_uri", redirectURI)
	form.Set("grant_type", "authorization_code")

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, g.cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("build the token request: %w", err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")

	response, err := g.cfg.HTTPClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("reach the token endpoint: %w", err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("the token endpoint answered %d: %s", response.StatusCode, oauthErrorCode(response.Body))
	}

	var body struct {
		IDToken string `json:"id_token"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("decode the token response: %w", err)
	}
	if body.IDToken == "" {
		return "", fmt.Errorf("the token response carries no id_token")
	}
	return body.IDToken, nil
}

// oauthErrorCode extracts the `error` field of an OAuth error response and
// nothing else.
//
// The whole body is deliberately not reported. It is attacker-adjacent data on
// the path most likely to be logged, and the request it answers carried the
// client secret — a provider that echoed the request back would put the secret
// into a log line. The OAuth error code is the part that helps an operator
// ("invalid_grant" means the code was already used), so it is the part kept.
func oauthErrorCode(body io.Reader) string {
	var parsed struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(body, 1<<14)).Decode(&parsed); err != nil || parsed.Error == "" {
		return "with no error code"
	}
	return parsed.Error
}

// idTokenClaims is the subset of the OIDC claim set this server validates.
type idTokenClaims struct {
	Issuer        string `json:"iss"`
	Subject       string `json:"sub"`
	Audience      string `json:"aud"`
	ExpiresAt     int64  `json:"exp"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
}

// verifyIDToken checks the signature and then every claim the login depends on.
//
// The order matters: nothing from the payload is read until the signature has
// been verified against a key Google publishes. Reading claims first and
// checking the signature afterwards is the classic shape of this bug, and it is
// invisible in a test that only ever feeds it valid tokens.
func (g *Google) verifyIDToken(ctx context.Context, idToken string) (string, string, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return "", "", fmt.Errorf("the id_token is not a JWT: %d segments", len(parts))
	}

	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", "", fmt.Errorf("decode the token header: %w", err)
	}
	var header struct {
		Algorithm string `json:"alg"`
		KeyID     string `json:"kid"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return "", "", fmt.Errorf("parse the token header: %w", err)
	}
	// RS256 only, and refusing everything else is the whole point: "none" is an
	// unsigned token, and accepting an HMAC algorithm here would verify a
	// signature made with a key the token itself names.
	if header.Algorithm != "RS256" {
		return "", "", fmt.Errorf("the token is signed with %q, and only RS256 is accepted", header.Algorithm)
	}

	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return "", "", fmt.Errorf("decode the token signature: %w", err)
	}
	key, err := g.publicKey(ctx, header.KeyID)
	if err != nil {
		return "", "", err
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature); err != nil {
		return "", "", fmt.Errorf("the token signature does not verify: %w", err)
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", "", fmt.Errorf("decode the token payload: %w", err)
	}
	var claims idTokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", "", fmt.Errorf("parse the token claims: %w", err)
	}

	if now := g.cfg.Now().Unix(); claims.ExpiresAt <= now {
		return "", "", fmt.Errorf("the token expired at %d and it is now %d", claims.ExpiresAt, now)
	}
	if !g.acceptableIssuer(claims.Issuer) {
		return "", "", fmt.Errorf("the token was issued by %q", claims.Issuer)
	}
	// Without this check any Google account holder could take an ID token their
	// own application received and present it here.
	if claims.Audience != g.cfg.ClientID {
		return "", "", fmt.Errorf("the token was issued for another client")
	}
	if !claims.EmailVerified {
		return "", "", fmt.Errorf("the token carries an unverified email address")
	}
	if claims.Email == "" || claims.Subject == "" {
		return "", "", fmt.Errorf("the token carries no email or no subject")
	}
	return claims.Email, claims.Subject, nil
}

// acceptableIssuer accepts both spellings Google uses. The bare form is
// legitimate and appears in real tokens, so refusing it would refuse real logins
// — while still refusing anything that is neither.
func (g *Google) acceptableIssuer(issuer string) bool {
	if issuer == g.cfg.Issuer {
		return true
	}
	return g.cfg.Issuer == defaultIssuer && issuer == "accounts.google.com"
}

// publicKey returns the published key with this id, fetching the set when the
// cache is cold, stale, or does not know the id.
//
// The unknown-id refetch is what survives a key rotation: Google rotates on its
// own schedule, and a provider that answered from a cache would refuse every
// login until the process restarted.
func (g *Google) publicKey(ctx context.Context, keyID string) (*rsa.PublicKey, error) {
	g.jwks.mu.Lock()
	defer g.jwks.mu.Unlock()

	fresh := g.jwks.keys != nil && g.cfg.Now().Sub(g.jwks.fetched) < g.cfg.JWKSCacheTTL
	if fresh {
		if key, found := g.jwks.keys[keyID]; found {
			return key, nil
		}
	}

	keys, err := g.fetchKeySet(ctx)
	if err != nil {
		// The provider is unreachable, but the keys it published an hour ago are
		// almost certainly still the keys it uses: Google rotates on the order of
		// days. Refusing every login for the duration of somebody else's outage
		// is the worse failure, so a stale key that still matches the id is used
		// rather than discarded (#150 review, COR-7).
		if stale, found := g.jwks.keys[keyID]; found {
			return stale, nil
		}
		return nil, err
	}
	g.jwks.keys = keys
	g.jwks.fetched = g.cfg.Now()

	key, found := keys[keyID]
	if !found {
		return nil, fmt.Errorf("the provider publishes no key with id %q", keyID)
	}
	return key, nil
}

// fetchKeySet reads the published JWKS and turns the RSA entries into keys.
func (g *Google) fetchKeySet(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, g.cfg.JWKSURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build the key-set request: %w", err)
	}
	response, err := g.cfg.HTTPClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("reach the key set: %w", err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("the key set answered %d", response.StatusCode)
	}

	var document struct {
		Keys []struct {
			KeyID   string `json:"kid"`
			Type    string `json:"kty"`
			Modulus string `json:"n"`
			Exp     string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(response.Body).Decode(&document); err != nil {
		return nil, fmt.Errorf("decode the key set: %w", err)
	}

	keys := make(map[string]*rsa.PublicKey, len(document.Keys))
	for _, published := range document.Keys {
		// A key this code cannot express is skipped rather than fatal: Google
		// may publish an EC key beside the RSA ones, and a set that contains one
		// is not a broken set.
		if published.Type != "RSA" {
			continue
		}
		modulus, err := base64.RawURLEncoding.DecodeString(published.Modulus)
		if err != nil {
			continue
		}
		exponentBytes, err := base64.RawURLEncoding.DecodeString(published.Exp)
		if err != nil {
			continue
		}
		exponent := 0
		for _, b := range exponentBytes {
			exponent = exponent<<8 | int(b)
		}
		if exponent == 0 {
			continue
		}
		keys[published.KeyID] = &rsa.PublicKey{N: new(big.Int).SetBytes(modulus), E: exponent}
	}
	return keys, nil
}
