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
	"net/url"
	"os"
	"slices"
	"strings"
	"time"
)

// The environment variable names, exported so that the operator-facing
// documents and the tests refer to the same strings the loader reads.
const (
	KeyAddr        = "NALANDA_ADDR"
	KeyDatabaseURL = "NALANDA_DATABASE_URL"
	KeyLogLevel    = "NALANDA_LOG_LEVEL"
)

// The professor login of ADR-0009, added by #150. Separate block because these
// mean something different from the three above: without them the server starts
// and nobody can log in.
const (
	KeyPublicURL               = "NALANDA_PUBLIC_URL"
	KeyGoogleClientID          = "NALANDA_GOOGLE_CLIENT_ID"
	KeyGoogleClientSecret      = "NALANDA_GOOGLE_CLIENT_SECRET"
	KeySessionTTL              = "NALANDA_SESSION_TTL"
	KeyBootstrapProfessorEmail = "NALANDA_BOOTSTRAP_PROFESSOR_EMAIL"
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

// defaultSessionTTL is 30 days. Long, deliberately: the professor using this
// backoffice works in bursts weeks apart, and a shorter window buys nothing
// against a stolen cookie that logging out does not buy sooner.
const defaultSessionTTL = "720h"

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

	// PublicURL is the base URL this server is reached at. Two things are built
	// from it, which is why it is required rather than inferred from the
	// request: the OAuth redirect URI, which Google matches character for
	// character against what is registered, and the cookie's Secure flag.
	// Inferring it from the Host header would let a caller choose both.
	PublicURL string
	// GoogleClientID and GoogleClientSecret are the OAuth client of ADR-0009.
	GoogleClientID string
	// GoogleClientSecret never leaves this struct except towards Google's token
	// endpoint; see LogValue and String below, which are what keep it out of
	// logs and error messages.
	GoogleClientSecret string
	// SessionTTL is how long a session lives from creation. It is not a sliding
	// window: a professor logs in again after it, which at this scale is a
	// once-a-month interruption rather than a feature worth building.
	SessionTTL time.Duration
	// BootstrapProfessorEmail is the address allowed to adopt a server with no
	// professors at all. Empty disables the path entirely, which is what an
	// operator does once the first professor exists.
	BootstrapProfessorEmail string
}

// Keys lists every variable this package reads, in the order an operator would
// meet them. The example file is checked against this list, so a variable added
// to Config and forgotten in the documentation is a failing test.
func Keys() []string {
	return []string{
		KeyAddr, KeyDatabaseURL, KeyLogLevel,
		KeyPublicURL, KeyGoogleClientID, KeyGoogleClientSecret,
		KeySessionTTL, KeyBootstrapProfessorEmail,
	}
}

// Load reads the configuration through lookup.
func Load(lookup LookupFunc) (Config, error) {
	l := loader{lookup: lookup}

	cfg := Config{
		Addr:        l.required(KeyAddr),
		DatabaseURL: l.required(KeyDatabaseURL),
		LogLevel:    l.optional(KeyLogLevel, defaultLogLevel),

		PublicURL:               l.required(KeyPublicURL),
		GoogleClientID:          l.required(KeyGoogleClientID),
		GoogleClientSecret:      l.required(KeyGoogleClientSecret),
		BootstrapProfessorEmail: l.optional(KeyBootstrapProfessorEmail, ""),
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

	// Validated rather than merely read: Google matches the redirect URI it is
	// given against the one registered with the OAuth client, character for
	// character. A value that is not an absolute http(s) URL produces a login
	// that fails on Google's own error page, where this server's operator is not
	// looking.
	parsed, err := url.Parse(cfg.PublicURL)
	switch {
	case err != nil:
		return Config{}, fmt.Errorf("%s=%q is not a URL: %w", KeyPublicURL, cfg.PublicURL, err)
	case parsed.Scheme != "http" && parsed.Scheme != "https":
		return Config{}, fmt.Errorf(
			"%s=%q has scheme %q; it must be an absolute http or https URL",
			KeyPublicURL, cfg.PublicURL, parsed.Scheme,
		)
	case parsed.Host == "":
		return Config{}, fmt.Errorf("%s=%q names no host", KeyPublicURL, cfg.PublicURL)
	}

	ttl, err := time.ParseDuration(l.optional(KeySessionTTL, defaultSessionTTL))
	if err != nil {
		return Config{}, fmt.Errorf("%s is not a duration: %w", KeySessionTTL, err)
	}
	if ttl <= 0 {
		return Config{}, fmt.Errorf("%s=%v is not positive; a session would expire as it was created", KeySessionTTL, ttl)
	}
	cfg.SessionTTL = ttl

	return cfg, nil
}

// SecureCookie reports whether the session cookie carries the Secure attribute.
//
// Derived from PublicURL rather than configured, because the two settings can
// only ever disagree in one direction: a Secure cookie over http is never sent
// and nobody can log in, while a non-Secure cookie over https is a session token
// travelling in clear the first time anything downgrades. Neither is a choice
// worth offering an operator.
func (c Config) SecureCookie() bool {
	return strings.HasPrefix(c.PublicURL, "https://")
}

// LogValue is what slog prints for a Config, and it omits the client secret.
//
// This exists because the failure it prevents is an ordinary line of code: a
// slog.Any("config", cfg) in a boot message, added by someone debugging, puts an
// OAuth client secret into whatever collects container logs. Same reasoning as
// SafeDatabaseURL above, one field over.
func (c Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("addr", c.Addr),
		slog.String("database", c.SafeDatabaseURL()),
		slog.String("log_level", c.LogLevel),
		slog.String("public_url", c.PublicURL),
		slog.String("google_client_id", c.GoogleClientID),
		slog.String("session_ttl", c.SessionTTL.String()),
		slog.Bool("bootstrap_email_set", c.BootstrapProfessorEmail != ""),
	)
}

// String is the same guarantee for fmt: %v and %+v of a Config go through here
// rather than printing every field, so a debugging line cannot leak the secret
// either.
func (c Config) String() string {
	return fmt.Sprintf(
		"config{addr:%s database:%s log_level:%s public_url:%s google_client_id:%s session_ttl:%s bootstrap_email_set:%t}",
		c.Addr, c.SafeDatabaseURL(), c.LogLevel, c.PublicURL, c.GoogleClientID,
		c.SessionTTL, c.BootstrapProfessorEmail != "",
	)
}

// LoadFromEnv is what main calls: Load against the real process environment.
func LoadFromEnv() (Config, error) {
	return Load(os.LookupEnv)
}

// SafeDatabaseURL is the value to put in a log line or an error message.
//
// Today DatabaseURL is a filesystem path and there is nothing to hide. But the
// field is named URL because ADR-0007 expects a Postgres DSN here one day, and
// a libpq DSN carries the password inline (`postgres://user:pass@host/db`) —
// at which point every boot would write it to stderr, into whatever collects
// container logs (#149 review, S5). Three lines now; an audit of every log sink
// that ever held the DSN later.
func (c Config) SafeDatabaseURL() string {
	parsed, err := url.Parse(c.DatabaseURL)
	// A bare path parses without error and has no Userinfo, so Redacted returns
	// it unchanged — which is why this is safe to apply unconditionally.
	if err != nil || parsed.User == nil {
		return c.DatabaseURL
	}
	return parsed.Redacted()
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
