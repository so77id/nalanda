package oidctest_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/infra/oidc/oidctest"
)

// A test double gets its own tests, because a double that lies is worse than no
// double: every case that leans on it goes green while asserting nothing. These
// pin the two properties the surface tests will depend on — that it records what
// it was asked, and that a configured failure looks like a real one.

func TestProviderReturnsWhatItWasConfiguredWith(t *testing.T) {
	provider := &oidctest.Provider{Email: "profesora@example.com", Subject: "sub-1"}

	email, subject, err := provider.Exchange(context.Background(), "code", "https://nalanda.test/callback")
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if email != "profesora@example.com" || subject != "sub-1" {
		t.Errorf("Exchange = (%q, %q), want the configured identity", email, subject)
	}
	if provider.Exchanges() != 1 {
		t.Errorf("Exchanges = %d, want 1", provider.Exchanges())
	}
	if provider.LastRedirectURI() != "https://nalanda.test/callback" {
		t.Errorf("LastRedirectURI = %q", provider.LastRedirectURI())
	}
}

// The real provider returns empty strings alongside its error, and a double that
// returned the identity anyway would hide a caller that ignores the error.
func TestAConfiguredFailureCarriesNoIdentity(t *testing.T) {
	refused := errors.New("the token was issued for another client")
	provider := &oidctest.Provider{Email: "profesora@example.com", Subject: "sub-1", Err: refused}

	email, subject, err := provider.Exchange(context.Background(), "code", "https://nalanda.test/callback")
	if !errors.Is(err, refused) {
		t.Fatalf("Exchange error = %v, want the configured one", err)
	}
	if email != "" || subject != "" {
		t.Errorf("Exchange returned (%q, %q) with its error, want empty strings", email, subject)
	}
}

func TestAuthCodeURLRecordsTheState(t *testing.T) {
	provider := &oidctest.Provider{}

	url := provider.AuthCodeURL("the-nonce", "https://nalanda.test/callback")

	if provider.LastState() != "the-nonce" {
		t.Errorf("LastState = %q, want the nonce it was given", provider.LastState())
	}
	if !strings.Contains(url, "the-nonce") {
		t.Errorf("AuthCodeURL = %q, want it to carry the state", url)
	}
}
