// Package amcworker is the HTTP adapter for apps/amc-worker's /generate route
// (ADR-0030). It implements controls.Generator: an infra type over an interface
// declared where the domain consumes it (backend-code-style.md §The dependency
// rule).
//
// The wrapper here does two things AMC does not do for itself. It serialises
// calls so two concurrent generations of the same project cannot race AMC's
// sqlite state (ADR-0030 §The worker is threaded; AMC is not re-entrant), and
// it turns transport failures into the domain's sentinels so a handler can tell
// "operator misconfigured the URL" from "the worker refused the request".
package amcworker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// Client is a controls.Generator against a running worker. Constructed once
// in cmd/server; safe for concurrent use — every /generate call goes through
// the same mutex.
//
// Deliberately narrow: this client only speaks the routes WP-E needs. The
// analyse/associate/annotate half of the worker's contract lives in a
// sibling file when WP-F is written; splitting them by consumer keeps the
// deprecation cost of the analyse shape (which is minutes-long and background
// only, ADR-0030) out of a synchronous generate call.
type Client struct {
	base string
	http *http.Client

	// generateLock serialises /generate. AMC's state is sqlite files in the
	// project directory and two concurrent runs against one project would
	// race them; the ADR spells out that a global lock is the worked-around
	// price. It sits here rather than on the worker because Go's caller is
	// where control lives, and the worker (§C9) has no auth to police it.
	generateLock sync.Mutex
}

// Config is what New takes. HTTPClient is optional: nil means the default
// client. The domain-facing timeout comes from the caller's context — a
// call-site deadline is the right shape for a synchronous generation, since
// the request is being held by a browser (ADR-0030 §Consequences: only
// analyse is minutes-class; generate is seconds-class).
type Config struct {
	// BaseURL is the worker's HTTP origin, e.g. http://amc-worker:8080.
	// No trailing slash and no path — it names the origin, not a route.
	BaseURL string
	// HTTPClient is the transport. Optional. A caller that wants to bound
	// connect/read separately provides one; the default is
	// http.DefaultClient, which honours the caller's context deadline.
	HTTPClient *http.Client
}

// New returns a Client. Refuses a set it cannot serve with — a common shape
// with the other constructors in this repo: cmd/server panics at boot rather
// than nil-dereferences inside a request (backend-code-style.md §Errors).
//
// The URL is not just checked for emptiness: it is parsed, and a value that
// is not an absolute http/https URL is rejected. A relative BaseURL would
// silently build a request against the process's cwd — measured against a
// misconfigured value in the design conversation, it produced a runtime
// error about "no Host in request URL" that named nothing about the config.
func New(cfg Config) *Client {
	switch {
	case cfg.BaseURL == "":
		panic("amcworker.New: no BaseURL — the worker's origin, e.g. http://amc-worker:8080")
	}
	parsed, err := url.Parse(cfg.BaseURL)
	if err != nil {
		panic(fmt.Sprintf("amcworker.New: BaseURL %q is not a URL: %v", cfg.BaseURL, err))
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		panic(fmt.Sprintf("amcworker.New: BaseURL %q must be an absolute http or https URL", cfg.BaseURL))
	}
	if parsed.Host == "" {
		panic(fmt.Sprintf("amcworker.New: BaseURL %q names no host", cfg.BaseURL))
	}

	client := cfg.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	return &Client{
		base: strings.TrimRight(cfg.BaseURL, "/"),
		http: client,
	}
}

// Generate runs POST /generate against the worker, serialised.
//
// A caller-level context is what bounds the call: the handler wraps its
// http.Request context with the target deadline (issue #166 AC-4). This
// method does not add its own timeout — a second one would be a value the
// domain does not know about, able to overrule what the handler set.
func (c *Client) Generate(ctx context.Context, req controls.GenerateRequest) (controls.Assets, error) {
	if req.Copies < 1 {
		// Refused before we serialise, so a bad call does not wait behind
		// a good one for no reason.
		return controls.Assets{}, fmt.Errorf("%w: copies must be at least 1, got %d",
			controls.ErrGeneratorRefused, req.Copies)
	}
	if req.Project == "" {
		return controls.Assets{}, fmt.Errorf("%w: project path is required", controls.ErrGeneratorRefused)
	}
	if req.Source == "" {
		return controls.Assets{}, fmt.Errorf("%w: source path is required", controls.ErrGeneratorRefused)
	}

	c.generateLock.Lock()
	defer c.generateLock.Unlock()

	body, err := json.Marshal(generateRequestBody{
		Project: req.Project,
		Source:  req.Source,
		Copies:  req.Copies,
	})
	if err != nil {
		// json.Marshal of a value with basic types cannot fail today; the
		// branch exists because the encoder's contract does not promise so.
		return controls.Assets{}, fmt.Errorf("amcworker: encode request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/generate", bytes.NewReader(body))
	if err != nil {
		return controls.Assets{}, fmt.Errorf("amcworker: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		// A context-canceled failure is neither refusal nor unreachability
		// from the operator's point of view: the caller decided to stop
		// waiting. Report it as such so a canceled request does not read
		// as a worker outage in the logs.
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return controls.Assets{}, fmt.Errorf("amcworker: %w", err)
		}
		return controls.Assets{}, fmt.Errorf("%w: %v", controls.ErrGeneratorUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()

	// Cap the read: the worker's reply is a handful of paths and a number;
	// anything approaching this is a runaway response and not a payload.
	const maxRead = 1 << 20
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxRead))
	if err != nil {
		return controls.Assets{}, fmt.Errorf("%w: read response: %v", controls.ErrGeneratorUnavailable, err)
	}

	if resp.StatusCode != http.StatusOK {
		// Try to pull the worker's { error, detail } out of the body, but
		// do not fail closed if it is not JSON: the value here is the
		// status and the raw body's leading text, both useful for
		// diagnosis.
		//
		// `detail` is the last 4000 chars of AMC's stderr — the LaTeX
		// error, the missing file, the pdflatex Emergency stop. Without
		// it "prepare failed (1)" is unactionable (issue #206 §Notes
		// follow-up: "Worker payload.Detail is not propagated to the
		// server log — the 44 ERR lines never appeared, forcing manual
		// reproduction to diagnose"). Capped so the wire-worst case of a
		// full 4000-char AMC dump still fits one log line.
		var payload workerError
		if jerr := json.Unmarshal(respBody, &payload); jerr == nil && payload.Error != "" {
			if payload.Detail != "" {
				return controls.Assets{}, fmt.Errorf("%w: %s answered %d: %s (worker detail: %s)",
					controls.ErrGeneratorRefused, req.Project, resp.StatusCode,
					payload.Error, truncateDetail(payload.Detail))
			}
			return controls.Assets{}, fmt.Errorf("%w: %s answered %d: %s",
				controls.ErrGeneratorRefused, req.Project, resp.StatusCode, payload.Error)
		}
		return controls.Assets{}, fmt.Errorf("%w: %s answered %d: %s",
			controls.ErrGeneratorRefused, req.Project, resp.StatusCode, truncateForLog(respBody))
	}

	var payload generateResponseBody
	if err := json.Unmarshal(respBody, &payload); err != nil {
		return controls.Assets{}, fmt.Errorf("%w: decode response: %v", controls.ErrGeneratorRefused, err)
	}

	// The wire-level completeness checks stay HERE, on the wire type,
	// because they are properties of the /generate response — not
	// something the domain models. Missing paths or a wrong copy count
	// both reduce to ErrGeneratorRefused, which is the shape a handler
	// renders.
	if payload.Sujet == "" || payload.Corrige == "" || payload.Calage == "" {
		return controls.Assets{}, fmt.Errorf("%w: worker returned an incomplete response: %+v",
			controls.ErrGeneratorRefused, payload)
	}
	if payload.Copies != req.Copies {
		return controls.Assets{}, fmt.Errorf("%w: worker generated %d copies, asked for %d",
			controls.ErrGeneratorRefused, payload.Copies, req.Copies)
	}

	return controls.Assets{Sujet: payload.Sujet}, nil
}

// truncateForLog keeps a response body short enough to log without dumping a
// stray HTML page in full. 200 bytes is enough to see the leading tag and
// the first line of a real error.
func truncateForLog(b []byte) string {
	const max = 200
	if len(b) > max {
		return string(b[:max]) + "…"
	}
	return string(b)
}

// truncateDetail keeps the worker's AMC-stderr detail short enough to fit a
// single log line. 1200 chars covers a Package Listings Error's file line,
// an Emergency stop, and the "Fatal error occurred" tail — the three lines
// that identify what pdflatex actually rejected. The worker itself caps at
// 4000, so this is a second gate against a runaway log entry.
func truncateDetail(s string) string {
	const max = 1200
	// Newlines interpolated into a slog Errorf line become "\n" that
	// splits the message across lines — a log aggregator then sees
	// several unindexable half-messages. Collapse.
	s = strings.ReplaceAll(s, "\n", " | ")
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}

// Assert the interface at compile time — the storage.Prober shape.
var _ controls.Generator = (*Client)(nil)

// --- wire shapes -------------------------------------------------------------
//
// Package-private because they are the transport, not the domain: the domain
// sees controls.GenerateRequest and controls.Assets.

type generateRequestBody struct {
	Project string `json:"project"`
	Source  string `json:"source"`
	Copies  int    `json:"copies"`
}

type generateResponseBody struct {
	Sujet   string `json:"sujet"`
	Corrige string `json:"corrige"`
	Calage  string `json:"calage"`
	Copies  int    `json:"copies"`
}

type workerError struct {
	Error  string `json:"error"`
	Detail string `json:"detail"`
}
