package config_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// env is a fully-populated environment; each case takes a copy and breaks
// exactly one thing, so a case can never pass because a second variable was
// also wrong.
func env() map[string]string {
	return map[string]string{
		"NALANDA_ADDR":         "127.0.0.1:8081",
		"NALANDA_DATABASE_URL": "/var/lib/nalanda/nalanda.db",
		"NALANDA_LOG_LEVEL":    "info",
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
	for _, key := range []string{"NALANDA_ADDR", "NALANDA_DATABASE_URL"} {
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
	for _, key := range []string{"NALANDA_ADDR", "NALANDA_DATABASE_URL"} {
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
func TestExampleEnvFileDeclaresEveryVariable(t *testing.T) {
	example := readExampleEnv(t)
	for _, key := range config.Keys() {
		if !strings.Contains(example, key+"=") {
			t.Errorf(".env.example does not declare %s — add it, with a comment saying what it is for", key)
		}
	}
	if len(config.Keys()) == 0 {
		t.Fatal("config.Keys() is empty, so this test verified nothing")
	}
}
