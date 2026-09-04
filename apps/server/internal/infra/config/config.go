// Package config reads the server's configuration from the environment, once,
// at boot.
//
// The rule this package exists to enforce: a variable that is not set is an
// error naming it, never a zero value quietly taken as a default. A server that
// starts with an empty database path is a server that fails later, somewhere
// else, with a message about something unrelated.
package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/secret"
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
	// KeyTrustProxyHeaders is the deploy-time answer to "does a proxy sit
	// in front of this server, and does it own X-Forwarded-For". False in
	// development and in every deploy where the server terminates its own
	// TLS; true behind Tailscale Funnel (#162), where the proxy is the
	// visitor's peer and RemoteAddr is 127.0.0.1. Absent (or "false") is
	// the safe default — a client-supplied header would put an attacker's
	// chosen string in the sessions table.
	KeyTrustProxyHeaders = "NALANDA_TRUST_PROXY_HEADERS"
)

// The entrance-controls WP-E block (#166). Separate block because these
// mean something different again: without them the CONTROL SCREENS refuse
// to work, but the login and health paths still answer.
const (
	// KeyQuestionsJSONURL points at the published question bank (ADR-0032).
	// http/https for production, file:// for development. The Load happens
	// once at boot and a parse failure is a panic there, so the value is
	// required.
	KeyQuestionsJSONURL = "NALANDA_QUESTIONS_JSON_URL"
	// KeyAmcWorkerURL is where the AMC worker's /generate is reached
	// (ADR-0030). Absolute http/https URL.
	KeyAmcWorkerURL = "NALANDA_AMC_WORKER_URL"
	// KeyWorkDir is the shared volume mount point on the SERVER'S side.
	// The two containers share the amc-work named volume and its
	// seeding order is load-bearing — the whole rule (UID 65532 vs
	// root, first mounter seeds the volume, why compose up --wait
	// cannot see the failure) lives in ADR-0034 §Consequences
	// ("The shared amc-work volume ... has a seeding order that is
	// load-bearing"). The generator writes /work absolute paths from
	// the WORKER's side regardless of what this server names its own.
	KeyWorkDir = "NALANDA_WORK_DIR"
)

// The entrance-controls WP-F block (#167). Optional variables that bound
// what the scan upload will accept.
const (
	// KeyMaxScanMB is the largest scan PDF the upload handler will accept,
	// in whole megabytes. Optional — defaults to 100. A single scan of a
	// four-page control at 300 dpi is roughly 3-5 MB, so 100 is generous
	// enough that a rare four-double-sided-sheet class fits and a runaway
	// upload is refused before it enters the worker.
	KeyMaxScanMB = "NALANDA_MAX_SCAN_MB"
	// KeyAnnotateEnabled is the annotate loop's master switch (issue #190
	// §Reversibility). Optional — defaults to true. When "false", the
	// server never calls the worker's /annotate/copy, writes no
	// annotated_copy rows, and the review page serves the raw scan: the
	// escape hatch if the AMC-patching approach breaks against a real
	// batch in production.
	KeyAnnotateEnabled = "NALANDA_ANNOTATE_ENABLED"

	// KeyBankRefreshInterval is the cadence at which LiveBank.Watch calls
	// Reload against NALANDA_QUESTIONS_JSON_URL (issue #230). Optional —
	// defaults to 5 minutes, which matches the Watchtower poll cadence on
	// the Jetson deploy so the server refreshes at the same rhythm as
	// container updates. "0s" disables the ticker, and then the manual
	// admin button is the only refresh path.
	KeyBankRefreshInterval = "NALANDA_BANK_REFRESH_INTERVAL"
)

// The roster / Canvas block (#271, WP-1 of epic #270). One variable, and it
// is OPTIONAL on purpose — see the doc comment on Config.SecretsMasterKey.
const (
	// KeySecretsMasterKey is the AES-256 key that seals every row of
	// user_secrets (internal/domain/secret, ADR-0068). Base64 of exactly 32
	// random bytes: `openssl rand -base64 32`.
	KeySecretsMasterKey = "NALANDA_SECRETS_MASTER_KEY"
	// KeyCanvasGraphQLURL is the Canvas GraphQL endpoint the roster import
	// talks to. Optional: empty means the client's own default, UDP's
	// https://udp.instructure.com/api/graphql. It exists so a test can
	// point at an httptest server and a second institution costs no code.
	//
	// The default lives on canvas.Client rather than here so the literal
	// is written once; this package only refuses a value that is set and
	// unusable.
	KeyCanvasGraphQLURL = "NALANDA_CANVAS_GRAPHQL_URL"
)

// defaultMaxScanMB is what an unset KeyMaxScanMB resolves to.
const defaultMaxScanMB = 100

// defaultBankRefreshInterval is what an unset KeyBankRefreshInterval
// resolves to. Five minutes matches the Watchtower poll cadence on the
// Jetson (ADR-0038, `docs/decisions/0032-*`) — the server refreshes its
// bank at the same rhythm the container itself updates.
const defaultBankRefreshInterval = 5 * time.Minute

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
	// TrustProxyHeaders is true when a trusted reverse proxy terminates in
	// front of this server AND owns X-Forwarded-For. When true, the client
	// IP written to the sessions table is that header's first hop; when
	// false (the default), it is RemoteAddr. The header is honoured only
	// under this flag because otherwise it is a value the caller chose.
	TrustProxyHeaders bool

	// QuestionsJSONURL points at the published question bank
	// (ADR-0032). Fetched once at boot; a parse failure there is a panic.
	QuestionsJSONURL string
	// AmcWorkerURL is the AMC worker's HTTP origin.
	AmcWorkerURL string
	// WorkDir is where the server sees the shared volume with the worker.
	// The .tex the generator emits always uses /work absolute paths (from
	// the worker's perspective, controls.WorkerWorkDir) whatever this is.
	WorkDir string

	// MaxScanBytes is what the upload handler will accept. Derived from
	// KeyMaxScanMB (in whole megabytes) and expressed here as bytes so
	// callers can pass it straight into http.MaxBytesReader without
	// re-doing the multiplication.
	MaxScanBytes int64

	// AnnotateEnabled is the annotate loop's master switch (issue #190).
	// True unless KeyAnnotateEnabled is explicitly "false".
	AnnotateEnabled bool

	// BankRefreshInterval is how often LiveBank.Watch polls
	// QuestionsJSONURL for a fresh questions.json (issue #230). Zero
	// disables the ticker; a positive Go duration overrides the 5-minute
	// default.
	BankRefreshInterval time.Duration

	// SecretsMasterKey is the decoded 32-byte AES-256 key that seals
	// user_secrets, or nil when the operator has not configured one
	// (issue #271, ADR-0068).
	//
	// This is the only OPTIONAL-BUT-STRICTLY-VALIDATED variable in the
	// struct, and the asymmetry is deliberate:
	//
	//   - Absent (or empty) → nil, and the Canvas integration reports
	//     itself unconfigured. Making it required would take production
	//     down between a merge and the moment the operator edits the
	//     Jetson's .env: the CD workflow rebuilds the image and Watchtower
	//     restarts the container within five minutes (ADR-0038), so the
	//     window is not one an operator can stand in front of.
	//   - Present but not base64 of exactly 32 bytes → Load fails naming
	//     the variable. A typo must not read as "not configured", because
	//     that is a deployment that silently stores nothing while looking
	//     healthy.
	//
	// Never logged. LogValue and String report only whether it is set —
	// this key opens every professor's Canvas token.
	SecretsMasterKey []byte

	// CanvasGraphQLURL is the Canvas GraphQL endpoint, or "" for the
	// client's own default (UDP's). Validated when set.
	CanvasGraphQLURL string
}

// SecretsConfigured reports whether a usable master key was configured, and
// therefore whether anything that stores a per-professor secret can work.
// Callers render "integración no configurada" rather than a form when it is
// false; nothing panics.
func (c Config) SecretsConfigured() bool {
	return len(c.SecretsMasterKey) == secret.MasterKeySize
}

// Keys lists every variable this package reads, in the order an operator would
// meet them. The example file is checked against this list, so a variable added
// to Config and forgotten in the documentation is a failing test.
func Keys() []string {
	return []string{
		KeyAddr, KeyDatabaseURL, KeyLogLevel,
		KeyPublicURL, KeyGoogleClientID, KeyGoogleClientSecret,
		KeySessionTTL, KeyBootstrapProfessorEmail, KeyTrustProxyHeaders,
		KeyQuestionsJSONURL, KeyAmcWorkerURL, KeyWorkDir,
		KeyMaxScanMB, KeyAnnotateEnabled,
		KeyBankRefreshInterval,
		KeySecretsMasterKey, KeyCanvasGraphQLURL,
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

		QuestionsJSONURL: l.required(KeyQuestionsJSONURL),
		AmcWorkerURL:     l.required(KeyAmcWorkerURL),
		WorkDir:          l.required(KeyWorkDir),
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
	case parsed.RawQuery != "" || parsed.Fragment != "":
		// Same family as the path below, and just as invisible: a base URL with
		// a query or a fragment builds
		// https://host?x=1/login/google/callback, which Google refuses and the
		// router does not serve (#150 review, COR-4 residual).
		return Config{}, fmt.Errorf(
			"%s=%q carries a query or a fragment; it must be scheme, host and optional port only",
			KeyPublicURL, cfg.PublicURL,
		)
	case parsed.Path != "" && parsed.Path != "/":
		// A sub-path is rejected rather than accommodated, because accommodating
		// it is a lie the login only tells after Google's redirect: the routes
		// are mounted at the origin root and nothing sits in front of this
		// server, so a base of https://host/backoffice builds the redirect URI
		// https://host/backoffice/login/google/callback and the router answers
		// 404 on it. Measured, and a test in this package previously blessed
		// exactly that value as "what an operator will actually set"
		// (#150 review, COR-4).
		return Config{}, fmt.Errorf(
			"%s=%q carries the path %q; this server's routes are mounted at the root, "+
				"so a base URL with a path would build a redirect URI it does not serve",
			KeyPublicURL, cfg.PublicURL, parsed.Path,
		)
	}

	ttl, err := time.ParseDuration(l.optional(KeySessionTTL, defaultSessionTTL))
	if err != nil {
		return Config{}, fmt.Errorf("%s is not a duration: %w", KeySessionTTL, err)
	}
	if ttl <= 0 {
		return Config{}, fmt.Errorf("%s=%v is not positive; a session would expire as it was created", KeySessionTTL, ttl)
	}
	cfg.SessionTTL = ttl

	// Booleans parse through a strict helper with a tight allowed set:
	// "true" and "false", case-insensitive. A misspelling — "yes", "1",
	// "on" — is refused rather than silently taken as the default,
	// because falling to the wrong side of one of these switches is
	// exactly the shape that lets a client-supplied header end up in the
	// sessions table (or a broken annotate flow ship unnoticed), and
	// nothing downstream would notice.
	trustProxy, err := strictBool(&l, KeyTrustProxyHeaders, false)
	if err != nil {
		return Config{}, err
	}
	cfg.TrustProxyHeaders = trustProxy

	annotate, err := strictBool(&l, KeyAnnotateEnabled, true)
	if err != nil {
		return Config{}, err
	}
	cfg.AnnotateEnabled = annotate

	maxScanMB, err := parsePositiveInt(l.optional(KeyMaxScanMB, ""), defaultMaxScanMB)
	if err != nil {
		return Config{}, fmt.Errorf("%s: %w", KeyMaxScanMB, err)
	}
	cfg.MaxScanBytes = int64(maxScanMB) * (1 << 20)

	rawInterval := l.optional(KeyBankRefreshInterval, "")
	if rawInterval == "" {
		cfg.BankRefreshInterval = defaultBankRefreshInterval
	} else {
		interval, err := time.ParseDuration(rawInterval)
		if err != nil {
			return Config{}, fmt.Errorf("%s=%q is not a duration: %w", KeyBankRefreshInterval, rawInterval, err)
		}
		if interval < 0 {
			return Config{}, fmt.Errorf("%s=%v is negative; zero disables the ticker and a positive duration overrides the default", KeyBankRefreshInterval, interval)
		}
		cfg.BankRefreshInterval = interval
	}

	masterKey, err := parseMasterKey(l.optional(KeySecretsMasterKey, ""))
	if err != nil {
		return Config{}, err
	}
	cfg.SecretsMasterKey = masterKey

	// Validated only when set, because empty means "use the client's
	// default" rather than "unconfigured". A value that IS set and is not
	// an absolute http(s) URL would otherwise fail on the first professor
	// who pastes a token, with an error about Canvas rather than about
	// this variable.
	cfg.CanvasGraphQLURL = l.optional(KeyCanvasGraphQLURL, "")
	if cfg.CanvasGraphQLURL != "" {
		parsed, err := url.Parse(cfg.CanvasGraphQLURL)
		switch {
		case err != nil:
			return Config{}, fmt.Errorf("%s=%q is not a URL: %w", KeyCanvasGraphQLURL, cfg.CanvasGraphQLURL, err)
		case parsed.Scheme != "http" && parsed.Scheme != "https":
			return Config{}, fmt.Errorf(
				"%s=%q has scheme %q; it must be an absolute http or https URL",
				KeyCanvasGraphQLURL, cfg.CanvasGraphQLURL, parsed.Scheme)
		case parsed.Host == "":
			return Config{}, fmt.Errorf("%s=%q names no host", KeyCanvasGraphQLURL, cfg.CanvasGraphQLURL)
		}
	}

	return cfg, nil
}

// parseMasterKey decodes the base64 master key. An empty value is "not
// configured" and yields nil; anything else must decode to exactly
// secret.MasterKeySize bytes.
//
// No error here ever echoes the value, because the value IS the key: an
// error string reaches stderr, and stderr reaches whatever collects
// container logs. Same rule, and the same reason, as SafeDatabaseURL and
// Config.LogValue.
func parseMasterKey(raw string) ([]byte, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf(
			"%s is not valid base64; generate it with `openssl rand -base64 32`", KeySecretsMasterKey)
	}
	if len(key) != secret.MasterKeySize {
		return nil, fmt.Errorf(
			"%s decodes to %d bytes; AES-256 needs exactly %d (`openssl rand -base64 32`)",
			KeySecretsMasterKey, len(key), secret.MasterKeySize)
	}
	return key, nil
}

// parsePositiveInt returns the value or the default (when raw is empty). A
// non-empty non-integer or a non-positive value is refused.
func parsePositiveInt(raw string, fallback int) (int, error) {
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%q is not an integer", raw)
	}
	if n <= 0 {
		return 0, fmt.Errorf("%d is not positive", n)
	}
	return n, nil
}

// SecureCookie reports whether the session cookie carries the Secure attribute.
//
// Derived from PublicURL rather than configured, because the two settings can
// only ever disagree in one direction: a Secure cookie over http is never sent
// and nobody can log in, while a non-Secure cookie over https is a session token
// travelling in clear the first time anything downgrades. Neither is a choice
// worth offering an operator.
func (c Config) SecureCookie() bool {
	return SecureFor(c.PublicURL)
}

// SecureFor reports whether a base URL means the cookie carries Secure.
//
// It PARSES rather than comparing a prefix, and that is a security fix rather
// than tidiness: `url.Parse` lowercases the scheme, so `HTTPS://host` passed
// Load's validation while `strings.HasPrefix(raw, "https://")` answered false —
// a session cookie shipped without Secure over https, and nothing saw it
// (#150 review, COR-4 residual, found by the verifier).
//
// Exported because the two delivery-surface constructors derive the same flag
// and had each grown their own copy of the prefix comparison, which is how one
// bug became three.
func SecureFor(publicURL string) bool {
	parsed, err := url.Parse(publicURL)
	if err != nil {
		// Unreachable for a value Load accepted; false is the safe answer for
		// anything else, since a Secure cookie that never arrives is a login
		// nobody can complete and this direction only loses the attribute.
		return false
	}
	return strings.EqualFold(parsed.Scheme, "https")
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
		slog.Bool("trust_proxy_headers", c.TrustProxyHeaders),
		slog.String("questions_json_url", c.QuestionsJSONURL),
		slog.String("amc_worker_url", c.AmcWorkerURL),
		slog.String("work_dir", c.WorkDir),
		slog.Bool("annotate_enabled", c.AnnotateEnabled),
		slog.String("bank_refresh_interval", c.BankRefreshInterval.String()),
		slog.Bool("secrets_master_key_set", c.SecretsConfigured()),
		slog.String("canvas_graphql_url", c.CanvasGraphQLURL),
	)
}

// String is the same guarantee for fmt: %v and %+v of a Config go through here
// rather than printing every field, so a debugging line cannot leak the secret
// either.
func (c Config) String() string {
	return fmt.Sprintf(
		"config{addr:%s database:%s log_level:%s public_url:%s google_client_id:%s session_ttl:%s bootstrap_email_set:%t trust_proxy_headers:%t questions_json_url:%s amc_worker_url:%s work_dir:%s annotate_enabled:%t bank_refresh_interval:%s secrets_master_key_set:%t canvas_graphql_url:%s}",
		c.Addr, c.SafeDatabaseURL(), c.LogLevel, c.PublicURL, c.GoogleClientID,
		c.SessionTTL, c.BootstrapProfessorEmail != "", c.TrustProxyHeaders,
		c.QuestionsJSONURL, c.AmcWorkerURL, c.WorkDir, c.AnnotateEnabled,
		c.BankRefreshInterval, c.SecretsConfigured(), c.CanvasGraphQLURL,
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

// strictBool reads a boolean with a tight allowed set: "true"/"false",
// case-insensitive, fallback when absent. Anything else is an error naming
// the variable and the offending value — a misspelling must not silently
// land on the default.
func strictBool(l *loader, key string, fallback bool) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(l.optional(key, strconv.FormatBool(fallback)))) {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		raw, _ := l.lookup(key)
		return false, fmt.Errorf("%s=%q is not a boolean; expected true or false", key, raw)
	}
}
