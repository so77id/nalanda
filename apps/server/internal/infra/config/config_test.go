package config_test

import (
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// env is a fully-populated environment; each case takes a copy and breaks
// exactly one thing, so a case can never pass because a second variable was
// also wrong.
func env() map[string]string {
	return map[string]string{
		"NALANDA_ADDR":                      "127.0.0.1:8081",
		"NALANDA_DATABASE_URL":              "/var/lib/nalanda/nalanda.db",
		"NALANDA_LOG_LEVEL":                 "info",
		"NALANDA_PUBLIC_URL":                "https://nalanda.example.com",
		"NALANDA_GOOGLE_CLIENT_ID":          "client-id.apps.googleusercontent.com",
		"NALANDA_GOOGLE_CLIENT_SECRET":      "the-client-secret",
		"NALANDA_SESSION_TTL":               "168h",
		"NALANDA_BOOTSTRAP_PROFESSOR_EMAIL": "profesora@example.com",
		// WP-E (#166): the three variables the controls domain needs. A
		// case that breaks a different variable still needs these set,
		// otherwise every case would fail with the wrong reason.
		"NALANDA_QUESTIONS_JSON_URL": "https://nalanda.example.com/questions.json",
		"NALANDA_AMC_WORKER_URL":     "http://amc-worker:8080",
		"NALANDA_WORK_DIR":           "/work",
	}
}

func lookupFrom(m map[string]string) config.LookupFunc {
	return func(key string) (string, bool) {
		v, ok := m[key]
		return v, ok
	}
}

func TestLoadReadsEveryValue(t *testing.T) {
	cfg, err := config.Load(lookupFrom(env()))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.Addr != "127.0.0.1:8081" {
		t.Errorf("Addr = %q, want %q", cfg.Addr, "127.0.0.1:8081")
	}
	if cfg.DatabaseURL != "/var/lib/nalanda/nalanda.db" {
		t.Errorf("DatabaseURL = %q, want %q", cfg.DatabaseURL, "/var/lib/nalanda/nalanda.db")
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "info")
	}
}

// The point of the slice: a missing variable is an error that NAMES it, not a
// zero value silently taken as a default. Table-driven so that adding a
// variable to Config without adding it to the required set fails here.
func TestLoadFailsByNameOnAMissingVariable(t *testing.T) {
	for _, key := range []string{
		"NALANDA_ADDR",
		"NALANDA_DATABASE_URL",
		"NALANDA_PUBLIC_URL",
		"NALANDA_GOOGLE_CLIENT_ID",
		"NALANDA_GOOGLE_CLIENT_SECRET",
	} {
		t.Run(key, func(t *testing.T) {
			broken := env()
			delete(broken, key)

			_, err := config.Load(lookupFrom(broken))
			if err == nil {
				t.Fatalf("Load without %s returned no error, want one", key)
			}
			if !errors.Is(err, config.ErrMissing) {
				t.Errorf("error = %v, want it to wrap ErrMissing", err)
			}
			if !strings.Contains(err.Error(), key) {
				t.Errorf("error = %q, want it to name %q", err, key)
			}
		})
	}
}

// An empty string is a missing value, not a value. Left unhandled, an operator
// who writes `NALANDA_DATABASE_URL=` in a compose file gets the zero-value
// behaviour the previous test exists to forbid, through a different door.
func TestLoadTreatsAnEmptyValueAsMissing(t *testing.T) {
	broken := env()
	broken["NALANDA_DATABASE_URL"] = ""

	_, err := config.Load(lookupFrom(broken))
	if err == nil {
		t.Fatal("Load with an empty NALANDA_DATABASE_URL returned no error, want one")
	}
	if !errors.Is(err, config.ErrMissing) {
		t.Errorf("error = %v, want it to wrap ErrMissing", err)
	}
	if !strings.Contains(err.Error(), "NALANDA_DATABASE_URL") {
		t.Errorf("error = %q, want it to name NALANDA_DATABASE_URL", err)
	}
}

// Every variable missing at once reports every one of them. An operator
// starting from an empty environment should need one run to learn what to set,
// not one run per variable.
func TestLoadReportsEveryMissingVariableAtOnce(t *testing.T) {
	_, err := config.Load(lookupFrom(map[string]string{}))
	if err == nil {
		t.Fatal("Load with an empty environment returned no error, want one")
	}
	for _, key := range []string{
		"NALANDA_ADDR",
		"NALANDA_DATABASE_URL",
		"NALANDA_PUBLIC_URL",
		"NALANDA_GOOGLE_CLIENT_ID",
		"NALANDA_GOOGLE_CLIENT_SECRET",
	} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("error = %q, want it to name %q", err, key)
		}
	}
}

// NALANDA_LOG_LEVEL is the one variable with a default, because there is a
// sensible one and no way to get it wrong silently. It is still validated: a
// typo must be a startup error rather than a level nobody notices is off.
func TestLogLevel(t *testing.T) {
	t.Run("defaults when unset", func(t *testing.T) {
		withoutLevel := env()
		delete(withoutLevel, "NALANDA_LOG_LEVEL")

		cfg, err := config.Load(lookupFrom(withoutLevel))
		if err != nil {
			t.Fatalf("Load: %v", err)
		}
		if cfg.LogLevel != "info" {
			t.Errorf("LogLevel = %q, want the default %q", cfg.LogLevel, "info")
		}
	})

	t.Run("rejects an unknown level by name", func(t *testing.T) {
		broken := env()
		broken["NALANDA_LOG_LEVEL"] = "verbose"

		_, err := config.Load(lookupFrom(broken))
		if err == nil {
			t.Fatal("Load with NALANDA_LOG_LEVEL=verbose returned no error, want one")
		}
		if !strings.Contains(err.Error(), "NALANDA_LOG_LEVEL") || !strings.Contains(err.Error(), "verbose") {
			t.Errorf("error = %q, want it to name both the variable and the bad value", err)
		}
	})
}

// The example file is the operator's copy of the contract, so it drifts the
// moment a variable is added to Config and not to it. Reading the real file is
// the point: a fixture would agree with the code by construction.
//
// Line by line, not `strings.Contains`. The first version searched the whole
// file for "KEY=", which cannot tell a declaration from a comment — commenting
// out NALANDA_DATABASE_URL left the guard green while an operator copying the
// file got "required environment variable is not set" at boot, which is exactly
// what this test exists to prevent (#149 review, COR-4).
func TestExampleEnvFileDeclaresEveryVariable(t *testing.T) {
	declared := declaredInExampleEnv(t)

	for _, key := range config.Keys() {
		if !declared[key] {
			t.Errorf(".env.example does not DECLARE %s (a commented-out line does not count) — "+
				"add it, with a comment saying what it is for", key)
		}
	}
	if len(config.Keys()) == 0 {
		t.Fatal("config.Keys() is empty, so this test verified nothing")
	}
}

// The converse: a variable in the example that the loader never reads is an
// instruction to set something with no effect, which is worse than silence.
func TestExampleEnvFileDeclaresNothingTheLoaderIgnores(t *testing.T) {
	known := map[string]bool{}
	for _, key := range config.Keys() {
		known[key] = true
	}

	declared := declaredInExampleEnv(t)
	if len(declared) == 0 {
		t.Fatal("no declarations parsed out of .env.example, so both directions verified nothing")
	}

	for key := range declared {
		if !known[key] {
			t.Errorf(".env.example declares %s, which config.Keys() does not list — "+
				"either the loader stopped reading it, or it was never read", key)
		}
	}
}

// declaredInExampleEnv returns the keys the example file actually declares: a
// line whose first non-space characters are KEY=.
func declaredInExampleEnv(t *testing.T) map[string]bool {
	t.Helper()

	declared := map[string]bool{}
	for _, line := range strings.Split(readExampleEnv(t), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		key, _, found := strings.Cut(trimmed, "=")
		if found {
			declared[strings.TrimSpace(key)] = true
		}
	}
	return declared
}

// COR-3: the level was validated but nothing proved it had any effect —
// replacing the whole switch with `return slog.LevelInfo` left the suite green,
// so debug/warn/error could all have meant info.
func TestSlogLevelMapsEveryAcceptedLevel(t *testing.T) {
	for name, want := range map[string]slog.Level{
		"debug": slog.LevelDebug,
		"info":  slog.LevelInfo,
		"warn":  slog.LevelWarn,
		"error": slog.LevelError,
	} {
		t.Run(name, func(t *testing.T) {
			e := env()
			e["NALANDA_LOG_LEVEL"] = name

			cfg, err := config.Load(lookupFrom(e))
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if got := cfg.SlogLevel(); got != want {
				t.Errorf("SlogLevel() for %q = %v, want %v", name, got, want)
			}
		})
	}
}

// The redaction that matters only after the Postgres swap of ADR-0007, written
// now because doing it later means auditing every log sink that held the DSN.
func TestSafeDatabaseURL(t *testing.T) {
	for _, c := range []struct {
		name string
		url  string
		want string
	}{
		{"a filesystem path is unchanged", "/data/nalanda.db", "/data/nalanda.db"},
		{"a relative path is unchanged", "./nalanda.db", "./nalanda.db"},
		{"a DSN without credentials is unchanged", "postgres://host/db", "postgres://host/db"},
		{"a DSN password is redacted", "postgres://user:hunter2@host/db", "postgres://user:xxxxx@host/db"},
	} {
		t.Run(c.name, func(t *testing.T) {
			e := env()
			e["NALANDA_DATABASE_URL"] = c.url

			cfg, err := config.Load(lookupFrom(e))
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if got := cfg.SafeDatabaseURL(); got != c.want {
				t.Errorf("SafeDatabaseURL() = %q, want %q", got, c.want)
			}
			if c.url != c.want && strings.Contains(cfg.SafeDatabaseURL(), "hunter2") {
				t.Error("the password survived redaction")
			}
		})
	}
}
