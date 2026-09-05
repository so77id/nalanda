package config_test

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// NALANDA_SECRETS_MASTER_KEY (issue #271, ADR-0068). The whole point of
// these cases is the asymmetry the WP decided on with the professor:
//
//   - ABSENT is legal and means "the Canvas integration is not configured".
//     A required variable here would take the Jetson down between the merge
//     and the moment the operator edits the host's .env — the CD workflow
//     rebuilds the image and Watchtower restarts the container within five
//     minutes (ADR-0038), and no test in this repository would see it.
//   - PRESENT BUT WRONG is a hard boot failure naming the variable. A typo
//     that silently disabled encryption is the failure this whole package
//     exists to refuse.

// validKey is 32 bytes, base64-encoded — what `openssl rand -base64 32`
// produces.
var validKey = base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x2a}, 32))

func TestTheSecretsMasterKeyIsOptionalAndAbsenceLeavesItUnconfigured(t *testing.T) {
	cfg, err := config.Load(lookupFrom(env()))
	if err != nil {
		t.Fatalf("Load without the master key: %v — the variable is optional", err)
	}
	if cfg.SecretsConfigured() {
		t.Error("SecretsConfigured() is true with no master key set")
	}
	if cfg.SecretsMasterKey != nil {
		t.Errorf("SecretsMasterKey = %v with the variable absent, want nil", cfg.SecretsMasterKey)
	}
}

// The empty string is the same statement as absence — `KEY=` in a compose
// file is how an operator disables something, not how they configure it.
func TestAnEmptySecretsMasterKeyReadsAsAbsent(t *testing.T) {
	e := env()
	e["NALANDA_SECRETS_MASTER_KEY"] = ""

	cfg, err := config.Load(lookupFrom(e))
	if err != nil {
		t.Fatalf("Load with an empty master key: %v", err)
	}
	if cfg.SecretsConfigured() {
		t.Error("SecretsConfigured() is true for an empty master key")
	}
}

func TestASecretsMasterKeyDecodesToThirtyTwoBytes(t *testing.T) {
	e := env()
	e["NALANDA_SECRETS_MASTER_KEY"] = validKey

	cfg, err := config.Load(lookupFrom(e))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.SecretsConfigured() {
		t.Fatal("SecretsConfigured() is false for a valid 32-byte key")
	}
	if len(cfg.SecretsMasterKey) != 32 {
		t.Errorf("SecretsMasterKey is %d bytes, want 32", len(cfg.SecretsMasterKey))
	}
	if !bytes.Equal(cfg.SecretsMasterKey, bytes.Repeat([]byte{0x2a}, 32)) {
		t.Error("SecretsMasterKey is not the decoded value")
	}
}

// The other half of the asymmetry: a value that is present and unusable is a
// boot failure naming the variable, never a silent fallback to "unconfigured".
func TestAMalformedSecretsMasterKeyFailsTheBootByName(t *testing.T) {
	for _, c := range []struct {
		name  string
		value string
	}{
		{"not base64 at all", "no-es-base64-!!!"},
		{"base64 of 16 bytes", base64.StdEncoding.EncodeToString(make([]byte, 16))},
		{"base64 of 31 bytes", base64.StdEncoding.EncodeToString(make([]byte, 31))},
		{"base64 of 33 bytes", base64.StdEncoding.EncodeToString(make([]byte, 33))},
		{"the raw 32 characters, unencoded", strings.Repeat("a", 32)},
	} {
		t.Run(c.name, func(t *testing.T) {
			e := env()
			e["NALANDA_SECRETS_MASTER_KEY"] = c.value

			_, err := config.Load(lookupFrom(e))
			if err == nil {
				t.Fatal("Load accepted it, want a refusal")
			}
			if !strings.Contains(err.Error(), "NALANDA_SECRETS_MASTER_KEY") {
				t.Errorf("the error does not name the variable: %v", err)
			}
			// The value itself is a key. An error message that echoed it
			// would put it in the same container log the redaction below
			// keeps it out of.
			if strings.Contains(err.Error(), c.value) {
				t.Errorf("the error echoes the key material: %v", err)
			}
		})
	}
}

// The master key opens every stored Canvas token, so it is the one value in
// this struct that must never reach a log line — the same guarantee, and the
// same three paths, as TestTheClientSecretIsNeverPrinted next door.
func TestTheSecretsMasterKeyIsNeverPrinted(t *testing.T) {
	e := env()
	e["NALANDA_SECRETS_MASTER_KEY"] = validKey

	cfg, err := config.Load(lookupFrom(e))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	t.Run("formatted with %v", func(t *testing.T) {
		if printed := fmt.Sprintf("%v", cfg); strings.Contains(printed, validKey) {
			t.Errorf("%%v of the configuration prints the master key: %s", printed)
		}
	})
	t.Run("formatted with %+v", func(t *testing.T) {
		if printed := fmt.Sprintf("%+v", cfg); strings.Contains(printed, validKey) {
			t.Errorf("%%+v of the configuration prints the master key: %s", printed)
		}
	})
	t.Run("logged as a slog value", func(t *testing.T) {
		var out bytes.Buffer
		slog.New(slog.NewTextHandler(&out, nil)).Info("boot", "config", cfg)

		if strings.Contains(out.String(), validKey) {
			t.Errorf("a log line carrying the configuration prints the master key: %s", out.String())
		}
		// The raw bytes must not appear either: a LogValue that printed the
		// DECODED key would pass the base64 check above and leak just the
		// same.
		if strings.Contains(out.String(), "*****") {
			t.Errorf("a log line carrying the configuration prints the decoded key: %s", out.String())
		}
		// Non-vacuity, and the operator's actual question: the log says
		// WHETHER the integration is configured, without saying with what.
		if !strings.Contains(out.String(), "secrets_master_key_set=true") {
			t.Errorf("the log line does not report whether the master key is set: %s", out.String())
		}
	})
}

// SEC-2. A Canvas token is a full-permission credential travelling in an
// Authorization header on every profile load and every import. Over http to
// a non-loopback host that is a credential in clear, from a typo the server
// would otherwise boot healthy with. Loopback stays legal so a local stub
// and the suite's httptest servers keep working.
func TestTheCanvasEndpointRefusesPlainHTTPExceptOnLoopback(t *testing.T) {
	for _, c := range []struct {
		name    string
		value   string
		refused bool
	}{
		{"https anywhere", "https://udp.instructure.com/api/graphql", false},
		{"http to a real host", "http://udp.instructure.com/api/graphql", true},
		{"http to another real host", "http://canvas.example.com/api/graphql", true},
		{"http to localhost", "http://localhost:8099/api/graphql", false},
		{"http to 127.0.0.1", "http://127.0.0.1:8099/api/graphql", false},
		{"http to ::1", "http://[::1]:8099/api/graphql", false},
		{"empty, meaning the client default", "", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			e := env()
			e["NALANDA_CANVAS_GRAPHQL_URL"] = c.value

			_, err := config.Load(lookupFrom(e))
			switch {
			case c.refused && err == nil:
				t.Error("Load accepted plain http to a non-loopback host; a Canvas token would travel in clear")
			case c.refused && !strings.Contains(err.Error(), "NALANDA_CANVAS_GRAPHQL_URL"):
				t.Errorf("the refusal does not name the variable: %v", err)
			case !c.refused && err != nil:
				t.Errorf("Load refused %q: %v", c.value, err)
			}
		})
	}
}
