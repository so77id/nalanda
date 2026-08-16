// Package oidctest is a stand-in identity provider for tests that need a login
// to happen without needing Google to exist.
//
// It ships as a normal package rather than as a _test.go file because its users
// are in other packages — the delivery surface's handler tests — and Go does not
// share test files across packages. Nothing in cmd/server imports it, which is
// what keeps it out of the running binary's behaviour.
//
// What it is NOT is a substitute for internal/infra/oidc's own tests: those run
// a real RSA key against a real httptest provider, because a mock of a signature
// check verifies nothing about the signature check. This type exists so that a
// test ABOUT something else — the session cookie, the professor gate, the
// bootstrap path — does not have to build a JWT to get there.
package oidctest

import (
	"context"
	"fmt"
	"sync"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
)

// Provider answers Exchange with whatever it was configured to answer, and
// records what the caller asked for.
type Provider struct {
	// Email and Subject are what a successful Exchange returns.
	Email   string
	Subject string
	// Err, when set, is what Exchange returns instead — with empty strings, the
	// contract the real provider holds to.
	Err error
	// AuthURL is the prefix of the URL AuthCodeURL builds.
	AuthURL string

	mu sync.Mutex
	// LastState and LastRedirectURI record the last call, so a test can assert
	// that the surface passed the nonce it stored and the URI it will be called
	// back on.
	lastState       string
	lastRedirectURI string
	exchanges       int
}

var _ auth.OAuthProvider = (*Provider)(nil)

// AuthCodeURL records its arguments and returns a URL shaped like a real one.
func (p *Provider) AuthCodeURL(state, redirectURI string) string {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.lastState = state
	p.lastRedirectURI = redirectURI

	base := p.AuthURL
	if base == "" {
		base = "https://provider.test/auth"
	}
	return fmt.Sprintf("%s?state=%s&redirect_uri=%s", base, state, redirectURI)
}

// Exchange returns the configured identity, or the configured error.
func (p *Provider) Exchange(ctx context.Context, code, redirectURI string) (string, string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.lastRedirectURI = redirectURI
	p.exchanges++

	if p.Err != nil {
		return "", "", p.Err
	}
	return p.Email, p.Subject, nil
}

// LastState is the state nonce handed to the most recent AuthCodeURL.
func (p *Provider) LastState() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.lastState
}

// LastRedirectURI is the redirect URI of the most recent call of either method.
func (p *Provider) LastRedirectURI() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.lastRedirectURI
}

// Exchanges counts completed callbacks, so a test can tell "refused before
// talking to the provider" from "the provider refused".
func (p *Provider) Exchanges() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.exchanges
}
