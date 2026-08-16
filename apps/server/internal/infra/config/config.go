// Package config reads the server's configuration from the environment, once,
// at boot.
//
// The rule this package exists to enforce: a variable that is not set is an
// error naming it, never a zero value quietly taken as a default. A server that
// starts with an empty database path is a server that fails later, somewhere
// else, with a message about something unrelated.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"strings"
)

// The environment variable names, exported so that the operator-facing
// documents and the tests refer to the same strings the loader reads.
const (
	KeyAddr        = "NALANDA_ADDR"
	KeyDatabaseURL = "NALANDA_DATABASE_URL"
	KeyLogLevel    = "NALANDA_LOG_LEVEL"
)

// ErrMissing is wrapped by every error caused by an absent or empty required
// variable, so a caller can distinguish "the operator has not finished
// configuring this" from "the operator configured it wrongly".
var ErrMissing = errors.New("required environment variable is not set")

// defaultLogLevel is the only default in this package. It gets one because
// there is an obviously right value and no way for a wrong one to pass
// unnoticed — an unset level still logs, and the validation below rejects a
// typo rather than silently falling back.
const defaultLogLevel = "info"

// logLevels is the accepted set, listed rather than parsed by slog: the
// standard parser also accepts offsets like "INFO+2", which nobody here means
// to write and which would make a typo look deliberate.
var logLevels = []string{"debug", "info", "warn", "error"}

// LookupFunc is the seam that keeps this package testable without touching the
// process environment. os.LookupEnv satisfies it.
type LookupFunc func(key string) (string, bool)

// Config is the whole configuration of the server. It is read once and passed
// down; nothing below this package reads the environment.
type Config struct {
	// Addr is the address the HTTP server binds, as host:port.
	Addr string
	// DatabaseURL is the path to the SQLite file. Named URL rather than Path
	// because ADR-0007 expects a Postgres DSN here one day, and the callers
	// should not have to be renamed when that happens.
	DatabaseURL string
	// LogLevel is one of logLevels.
	LogLevel string
}

// Keys lists every variable this package reads, in the order an operator would
// meet them. The example file is checked against this list, so a variable added
// to Config and forgotten in the documentation is a failing test.
func Keys() []string {
	return []string{KeyAddr, KeyDatabaseURL, KeyLogLevel}
}

// Load reads the configuration through lookup.
func Load(lookup LookupFunc) (Config, error) {
	l := loader{lookup: lookup}

	cfg := Config{
		Addr:        l.required(KeyAddr),
		DatabaseURL: l.required(KeyDatabaseURL),
		LogLevel:    l.optional(KeyLogLevel, defaultLogLevel),
	}

	// Report every missing variable at once: an operator starting from an
	// empty environment should need one run to learn what to set, not one run
	// per variable.
	if len(l.missing) > 0 {
		return Config{}, fmt.Errorf("%w: %s", ErrMissing, strings.Join(l.missing, ", "))
	}

	if !slices.Contains(logLevels, cfg.LogLevel) {
		return Config{}, fmt.Errorf(
			"%s=%q is not a log level; expected one of %s",
			KeyLogLevel, cfg.LogLevel, strings.Join(logLevels, ", "),
		)
	}

	return cfg, nil
}

// LoadFromEnv is what main calls: Load against the real process environment.
func LoadFromEnv() (Config, error) {
	return Load(os.LookupEnv)
}

// SlogLevel maps the validated level onto slog's. Load has already rejected
// anything outside logLevels, so the default arm is unreachable by a
// configured value and exists only so the function is total.
func (c Config) SlogLevel() slog.Level {
	switch c.LogLevel {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// loader accumulates the names of the variables that were not usable, so that
// Load can report all of them together.
type loader struct {
	lookup  LookupFunc
	missing []string
}

// required returns the value of key, recording key as missing when it is absent
// OR empty. An empty value is a missing value: `NALANDA_DATABASE_URL=` in a
// compose file is the same mistake as omitting the line, and treating it as a
// value reopens the zero-value hole through a different door.
func (l *loader) required(key string) string {
	value, ok := l.lookup(key)
	if !ok || strings.TrimSpace(value) == "" {
		l.missing = append(l.missing, key)
		return ""
	}
	return value
}

// optional returns the value of key, or fallback when it is absent or empty.
func (l *loader) optional(key, fallback string) string {
	value, ok := l.lookup(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
