package config_test

import (
	"bytes"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

func TestLoadReadsTheAuthValues(t *testing.T) {
	cfg, err := config.Load(lookupFrom(env()))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.PublicURL != "https://nalanda.example.com" {
		t.Errorf("PublicURL = %q", cfg.PublicURL)
	}
	if cfg.GoogleClientID != "client-id.apps.googleusercontent.com" {
		t.Errorf("GoogleClientID = %q", cfg.GoogleClientID)
	}
	if cfg.GoogleClientSecret != "the-client-secret" {
		t.Errorf("GoogleClientSecret = %q", cfg.GoogleClientSecret)
	}
	if cfg.SessionTTL != 168*time.Hour {
		t.Errorf("SessionTTL = %v, want 168h", cfg.SessionTTL)
	}
	if cfg.BootstrapProfessorEmail != "profesora@example.com" {
		t.Errorf("BootstrapProfessorEmail = %q", cfg.BootstrapProfessorEmail)
	}
}

// The public URL is what the redirect URI is built from, and Google refuses a
// redirect URI that is not registered character for character. A value that is
// not an absolute http(s) URL produces a login that fails at the provider, with
// an error the operator reads on Google's page rather than in their own logs —
// so it is rejected at boot instead.
func TestPublicURLMustBeAnAbsoluteHTTPURL(t *testing.T) {
	for _, c := range []struct {
		name  string
		value string
	}{
		{"a bare host", "nalanda.example.com"},
		{"a path", "/nalanda"},
		{"another scheme", "ftp://nalanda.example.com"},
		{"a URL with no host", "https://"},
		{"something that is not a URL at all", "://"},
		// A sub-path used to be in the ACCEPTED set below, blessed as "what an
		// operator will actually set", until a probe showed the login it
		// produces ends in a 404: the redirect URI would be
		// https://host/backoffice/login/google/callback and the router serves
		// /login/google/callback (#150 review, COR-4).
		{"a base URL carrying a path", "https://nalanda.example.com/backoffice"},
	} {
		t.Run(c.name, func(t *testing.T) {
			broken := env()
			broken["NALANDA_PUBLIC_URL"] = c.value

			_, err := config.Load(lookupFrom(broken))
			if err == nil {
				t.Fatalf("Load with NALANDA_PUBLIC_URL=%q returned no error, want one", c.value)
			}
			if !strings.Contains(err.Error(), "NALANDA_PUBLIC_URL") {
				t.Errorf("error = %q, want it to name the variable", err)
			}
		})
	}
}

func TestPublicURLAcceptsWhatAnOperatorWillActuallySet(t *testing.T) {
	for _, value := range []string{
		"https://nalanda.example.com",
		"http://127.0.0.1:8081",
		"http://localhost:8081",
		// A bare trailing slash is the same origin rather than a sub-path, and
		// an operator copying a URL out of a browser bar will produce it.
		"https://nalanda.example.com/",
	} {
		t.Run(value, func(t *testing.T) {
			accepted := env()
			accepted["NALANDA_PUBLIC_URL"] = value

			if _, err := config.Load(lookupFrom(accepted)); err != nil {
				t.Errorf("Load with NALANDA_PUBLIC_URL=%q: %v", value, err)
			}
		})
	}
}

// The cookie's Secure flag is DERIVED from the public URL rather than
// configured, because the two can only disagree in one direction: a Secure
// cookie over http is never sent and the professor cannot log in, while a
// non-Secure cookie over https is a session token travelling in clear on any
// downgrade. Neither is a choice worth offering.
func TestSecureCookieFollowsThePublicURLScheme(t *testing.T) {
	for _, c := range []struct {
		publicURL string
		want      bool
	}{
		{"https://nalanda.example.com", true},
		{"http://127.0.0.1:8081", false},
		{"http://localhost:8081", false},
	} {
		t.Run(c.publicURL, func(t *testing.T) {
			values := env()
			values["NALANDA_PUBLIC_URL"] = c.publicURL

			cfg, err := config.Load(lookupFrom(values))
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if got := cfg.SecureCookie(); got != c.want {
				t.Errorf("SecureCookie() = %v for %q, want %v", got, c.publicURL, c.want)
			}
		})
	}
}

func TestSessionTTL(t *testing.T) {
	t.Run("defaults when unset", func(t *testing.T) {
		values := env()
		delete(values, "NALANDA_SESSION_TTL")

		cfg, err := config.Load(lookupFrom(values))
		if err != nil {
			t.Fatalf("Load: %v", err)
		}
		if cfg.SessionTTL != 30*24*time.Hour {
			t.Errorf("SessionTTL = %v, want the 30-day default", cfg.SessionTTL)
		}
	})

	// A duration that does not parse, or one that is zero or negative, would
	// otherwise produce sessions that expire the instant they are created — a
	// login that silently never works rather than a server that refuses to start.
	for _, c := range []struct {
		name  string
		value string
	}{
		{"not a duration", "a fortnight"},
		{"a bare number", "3600"},
		{"zero", "0s"},
		{"negative", "-1h"},
	} {
		t.Run("rejects "+c.name, func(t *testing.T) {
			broken := env()
			broken["NALANDA_SESSION_TTL"] = c.value

			_, err := config.Load(lookupFrom(broken))
			if err == nil {
				t.Fatalf("Load with NALANDA_SESSION_TTL=%q returned no error, want one", c.value)
			}
			if !strings.Contains(err.Error(), "NALANDA_SESSION_TTL") {
				t.Errorf("error = %q, want it to name the variable", err)
			}
		})
	}
}

// The bootstrap email is optional: a server whose professors already exist needs
// none. It is NOT required, so that the variable can be removed once the first
// professor is in, and the value stops being able to adopt an account.
func TestTheBootstrapEmailIsOptional(t *testing.T) {
	values := env()
	delete(values, "NALANDA_BOOTSTRAP_PROFESSOR_EMAIL")

	cfg, err := config.Load(lookupFrom(values))
	if err != nil {
		t.Fatalf("Load without a bootstrap email: %v", err)
	}
	if cfg.BootstrapProfessorEmail != "" {
		t.Errorf("BootstrapProfessorEmail = %q, want empty", cfg.BootstrapProfessorEmail)
	}
}

// AC-10. The client secret is the one value here that must never be written
// down, and the ways it escapes are all accidental: a %v of the struct while
// debugging, a slog.Any("config", cfg) in a boot line, an error that formats
// what it was given. Config therefore refuses to print it, whichever of those
// paths is taken.
func TestTheClientSecretIsNeverPrinted(t *testing.T) {
	cfg, err := config.Load(lookupFrom(env()))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	const secret = "the-client-secret"

	t.Run("formatted with %v", func(t *testing.T) {
		if printed := strings.Contains(fmt.Sprintf("%v", cfg), secret); printed {
			t.Errorf("%%v of the configuration prints the client secret: %s", fmt.Sprintf("%v", cfg))
		}
	})
	t.Run("formatted with %+v", func(t *testing.T) {
		if printed := strings.Contains(fmt.Sprintf("%+v", cfg), secret); printed {
			t.Errorf("%%+v of the configuration prints the client secret: %s", fmt.Sprintf("%+v", cfg))
		}
	})
	t.Run("logged as a slog value", func(t *testing.T) {
		var out bytes.Buffer
		slog.New(slog.NewTextHandler(&out, nil)).Info("boot", "config", cfg)

		if strings.Contains(out.String(), secret) {
			t.Errorf("a log line carrying the configuration prints the client secret: %s", out.String())
		}
		// Non-vacuity: a LogValue that returned nothing at all would pass the
		// assertion above while making the log line useless.
		if !strings.Contains(out.String(), "nalanda.example.com") {
			t.Errorf("the log line carries no configuration at all: %s", out.String())
		}
	})

	// And the value is still readable by the code that needs it — a redaction
	// that also hid it from the OAuth exchange would be a login that cannot work.
	if cfg.GoogleClientSecret != secret {
		t.Errorf("GoogleClientSecret = %q, want the value the provider needs", cfg.GoogleClientSecret)
	}
}

// A misconfiguration must not leak it either: the error naming a bad value is
// the other place a secret gets printed.
func TestAConfigurationErrorDoesNotCarryTheSecret(t *testing.T) {
	broken := env()
	broken["NALANDA_SESSION_TTL"] = "a fortnight"

	_, err := config.Load(lookupFrom(broken))
	if err == nil {
		t.Fatal("Load returned no error")
	}
	if strings.Contains(err.Error(), "the-client-secret") {
		t.Errorf("the configuration error carries the client secret: %v", err)
	}
	if errors.Is(err, config.ErrMissing) {
		t.Errorf("a malformed duration reported as a missing variable: %v", err)
	}
}

// The live defect the verifier found, and the reason SecureFor parses instead of
// comparing a prefix: url.Parse lowercases the scheme, so an operator who typed
// HTTPS:// passed Load's validation while the prefix comparison answered false —
// and the session cookie shipped without Secure over https, seen by nothing
// (#150 review, COR-4 residual).
func TestSecureCookieIsDecidedByTheSchemeNotByTheSpelling(t *testing.T) {
	for _, c := range []struct {
		publicURL string
		want      bool
	}{
		{"https://nalanda.example.com", true},
		{"HTTPS://nalanda.example.com", true},
		{"Https://nalanda.example.com", true},
		{"http://127.0.0.1:8081", false},
		{"HTTP://127.0.0.1:8081", false},
	} {
		t.Run(c.publicURL, func(t *testing.T) {
			values := env()
			values["NALANDA_PUBLIC_URL"] = c.publicURL

			cfg, err := config.Load(lookupFrom(values))
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if got := cfg.SecureCookie(); got != c.want {
				t.Errorf("SecureCookie() = %v for %q, want %v — a cookie without Secure over https "+
					"is a session token in clear on any downgrade", got, c.publicURL, c.want)
			}
			if got := config.SecureFor(c.publicURL); got != c.want {
				t.Errorf("SecureFor(%q) = %v, want %v — the surfaces derive the flag through this", c.publicURL, got, c.want)
			}
		})
	}
}

// The two neighbours of the sub-path bug, which build an equally broken redirect
// URI and were accepted until the verifier tried them.
func TestPublicURLRejectsAQueryOrAFragment(t *testing.T) {
	for _, value := range []string{
		"https://nalanda.example.com?x=1",
		"https://nalanda.example.com#seccion",
	} {
		t.Run(value, func(t *testing.T) {
			broken := env()
			broken["NALANDA_PUBLIC_URL"] = value

			_, err := config.Load(lookupFrom(broken))
			if err == nil {
				t.Fatalf("Load with NALANDA_PUBLIC_URL=%q returned no error, want one", value)
			}
			if !strings.Contains(err.Error(), "NALANDA_PUBLIC_URL") {
				t.Errorf("error = %q, want it to name the variable", err)
			}
		})
	}
}
