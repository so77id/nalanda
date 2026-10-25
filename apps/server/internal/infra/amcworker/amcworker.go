// Package amcworker is the HTTP adapter for apps/amc-worker (ADR-0030). It
// implements controls.Generator / Analyzer / Annotator and, since #310, the
// survey domain's ports — infra types over interfaces declared where each
// domain consumes them (backend-code-style.md §The dependency rule). This
// package may see both domains; neither domain sees the other (ADR-0078).
//
// The wrapper here does three things AMC does not do for itself. It serialises
// calls so two concurrent generations of the same project cannot race AMC's
// sqlite state (ADR-0030 §The worker is threaded; AMC is not re-entrant); it
// runs each call inside the file store's sync, so S3 holds what the call
// produced (issue #338); and it turns transport failures into the domain's
// sentinels so a handler can tell "operator misconfigured the URL" from "the
// worker refused the request".
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
	"path/filepath"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/files"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// Client is a controls.Generator against a running worker. Constructed once
// in cmd/server; safe for concurrent use — every call goes through the same
// lock.
//
// Deliberately narrow: this client only speaks the routes WP-E needs. The
// analyse/associate/annotate half of the worker's contract lives in a
// sibling file when WP-F is written; splitting them by consumer keeps the
// deprecation cost of the analyse shape (which is minutes-long and background
// only, ADR-0030) out of a synchronous generate call.
type Client struct {
	base string
	http *http.Client

	// lock serialises every call. AMC's state is sqlite files in the
	// project directory and two concurrent runs against one project would
	// race them; the ADR spells out that a global lock is the worked-around
	// price. It sits here rather than on the worker because Go's caller is
	// where control lives, and the worker (§C9) has no auth to police it.
	//
	// A one-slot channel, not a sync.Mutex, since #338's review (COR-2): a
	// call waiting for it stops waiting when its ctx ends. With a mutex a
	// review save behind another control's analyse — whose hold now
	// includes that analyse's hydrate and push — blocked for the whole
	// hold, past its own deadline, and then skipped the annotate it had
	// waited for. Taken only through serialised, serialisedAnnotate,
	// trySerialised, Exclusive and TryExclusive.
	lock chan struct{}

	// sync keeps a project's files and the file store in step around each
	// call (issue #338), or is nil with the local store.
	sync ProjectSync
}

// ProjectSync keeps one project's working copy on the volume and its copy in
// the file store in step around a worker call (issue #338 §3):
// filestore.Sync satisfies it. Around hydrates the project, runs call, then
// pushes and prunes what the call did. Every call here runs it INSIDE the
// worker lock, so nothing mutates a project while it is being copied — the
// copy is part of the critical section, not something beside it.
//
// AroundDeferringDatabases is Around for a call the bucket does not need
// AMC's databases from — /annotate/copy, which rewrites them as a
// by-product on every call, and /scans/reset, which deletes them: it leaves
// them for the next call of another kind (issue #338 review, PER-1 and its
// recheck).
//
// A push that fails after a call that succeeded wraps files.ErrNotStored:
// the work is done and on the volume, and the calls that return a result
// worth keeping — an analyse's report — return it with that error.
type ProjectSync interface {
	Around(ctx context.Context, project string, call func() error) error
	AroundDeferringDatabases(ctx context.Context, project string, call func() error) error
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
	// Sync is the file store's sync (issue #338). Optional: nil — the local
	// store, whose files ARE the working copy — runs each call as it is.
	Sync ProjectSync
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
		lock: make(chan struct{}, 1),
		sync: cfg.Sync,
	}
}

// Exclusive runs fn under the worker lock: the reconcile's way of reading a
// project no call is changing (issue #338). It waits, like every call but
// the resets and the purge — the reconcile is background work with nobody
// waiting on it.
func (c *Client) Exclusive(fn func() error) error {
	c.lock <- struct{}{}
	defer c.release()
	return fn()
}

// TryExclusive runs fn under the worker lock, or answers
// controls.ErrAnalyzerBusy at once without running it: the purge's file
// steps (issue #338 review, SEC-1). A worker call's push, or the reconcile,
// running beside the purge would upload again what the purge had just
// deleted from S3 — with no row left to find it. It never waits, for the
// resets' reason: the caller is a request the professor is waiting on.
func (c *Client) TryExclusive(fn func() error) error {
	if !c.tryAcquire() {
		return controls.ErrAnalyzerBusy
	}
	defer c.release()
	return fn()
}

// serialised is the one way a call reaches the worker (issue #338 review,
// ARQ-1): it waits for the lock — giving up when ctx ends — and runs call
// inside the file store's sync. A rule that held only by being repeated at
// every call site could be dropped at one of them with the whole suite
// green, and was, by mutation.
func (c *Client) serialised(ctx context.Context, project string, call func() error) error {
	if err := c.acquire(ctx); err != nil {
		return err
	}
	defer c.release()
	return c.inStep(ctx, project, false, call)
}

// serialisedAnnotate is serialised for /annotate/copy: the sync leaves the
// databases the annotate rewrites for the next other call
// (ProjectSync.AroundDeferringDatabases).
func (c *Client) serialisedAnnotate(ctx context.Context, project string, call func() error) error {
	if err := c.acquire(ctx); err != nil {
		return err
	}
	defer c.release()
	return c.inStep(ctx, project, true, call)
}

// trySerialised is serialised for a call that must never wait — the resets
// (ADR-0075 §5): busy at once when the lock is held. Its sync defers AMC's
// databases, which a reset deletes (ProjectSync.AroundDeferringDatabases):
// uploading what the annotates deferred, for the reset's prune to delete,
// would spend the synchronous reset's deadline on the uplink.
func (c *Client) trySerialised(ctx context.Context, project string, busy error, call func() error) error {
	if !c.tryAcquire() {
		return busy
	}
	defer c.release()
	return c.inStep(ctx, project, true, call)
}

// acquire waits for the lock until ctx ends.
func (c *Client) acquire(ctx context.Context) error {
	select {
	case c.lock <- struct{}{}:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("amcworker: waiting for the worker: %w", ctx.Err())
	}
}

func (c *Client) tryAcquire() bool {
	select {
	case c.lock <- struct{}{}:
		return true
	default:
		return false
	}
}

func (c *Client) release() { <-c.lock }

// inStep runs call between the file store's hydrate and push for project.
// The caller holds the lock. A sync failure is returned as the sync wrapped
// it (files.ErrSync); a worker failure as the call returned it.
func (c *Client) inStep(ctx context.Context, project string, deferDatabases bool, call func() error) error {
	switch {
	case c.sync == nil:
		return call()
	case deferDatabases:
		return c.sync.AroundDeferringDatabases(ctx, filepath.ToSlash(project), call)
	}
	return c.sync.Around(ctx, filepath.ToSlash(project), call)
}

// Generate runs POST /generate against the worker, serialised.
//
// A caller-level context is what bounds the call: the handler wraps its
// http.Request context with the target deadline (issue #166 AC-4). This
// method does not add its own timeout — a second one would be a value the
// domain does not know about, able to overrule what the handler set.
//
// A sheet generated whose copy to the store failed comes back with an error
// wrapping files.ErrNotStored: it exists, on the volume.
func (c *Client) Generate(ctx context.Context, req controls.GenerateRequest) (controls.Assets, error) {
	sujet, err := c.generate(ctx, req.Project, req.Source, req.Copies,
		controls.ErrGeneratorRefused, controls.ErrGeneratorUnavailable)
	if err != nil && !errors.Is(err, files.ErrNotStored) {
		return controls.Assets{}, err
	}
	return controls.Assets{Sujet: sujet}, err
}

// GenerateSheet is Generate for a survey run's sheet (issue #310): the same
// route, the same lock, the survey domain's own request type and
// sentinels — survey never sees a controls type (ADR-0078).
func (c *Client) GenerateSheet(ctx context.Context, req survey.GenerateRequest) (survey.Assets, error) {
	sujet, err := c.generate(ctx, req.Project, req.Source, req.Copies,
		survey.ErrGeneratorRefused, survey.ErrGeneratorUnavailable)
	if err != nil && !errors.Is(err, files.ErrNotStored) {
		return survey.Assets{}, err
	}
	return survey.Assets{Sujet: sujet}, err
}

// generate is POST /generate on the wire, for either domain: refused and
// unavailable are the CALLER's sentinels, so each domain branches on its
// own and neither imports the other's. Returns the subject PDF's path —
// with the error too when only the copy to the store failed
// (files.ErrNotStored), since the sheet is generated.
func (c *Client) generate(ctx context.Context, project, source string, copies int, refused, unavailable error) (string, error) {
	if copies < 1 {
		// Refused before we serialise, so a bad call does not wait behind
		// a good one for no reason.
		return "", fmt.Errorf("%w: copies must be at least 1, got %d",
			refused, copies)
	}
	if project == "" {
		return "", fmt.Errorf("%w: project path is required", refused)
	}
	if source == "" {
		return "", fmt.Errorf("%w: source path is required", refused)
	}

	var sujet string
	err := c.serialised(ctx, project, func() (err error) {
		sujet, err = c.postGenerate(ctx, project, source, copies, refused, unavailable)
		return err
	})
	return sujet, err
}

// postGenerate is the /generate request itself, under the lock and inside
// the sync.
func (c *Client) postGenerate(ctx context.Context, project, source string, copies int, refused, unavailable error) (string, error) {
	body, err := json.Marshal(generateRequestBody{
		Project: project,
		Source:  source,
		Copies:  copies,
	})
	if err != nil {
		// json.Marshal of a value with basic types cannot fail today; the
		// branch exists because the encoder's contract does not promise so.
		return "", fmt.Errorf("amcworker: encode request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/generate", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("amcworker: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		// A context-canceled failure is neither refusal nor unreachability
		// from the operator's point of view: the caller decided to stop
		// waiting. Report it as such so a canceled request does not read
		// as a worker outage in the logs.
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return "", fmt.Errorf("amcworker: %w", err)
		}
		return "", fmt.Errorf("%w: %v", unavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()

	// Cap the read: the worker's reply is a handful of paths and a number;
	// anything approaching this is a runaway response and not a payload.
	const maxRead = 1 << 20
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxRead))
	if err != nil {
		return "", fmt.Errorf("%w: read response: %v", unavailable, err)
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
				return "", fmt.Errorf("%w: %s answered %d: %s (worker detail: %s)",
					refused, project, resp.StatusCode,
					payload.Error, truncateDetail(payload.Detail))
			}
			return "", fmt.Errorf("%w: %s answered %d: %s",
				refused, project, resp.StatusCode, payload.Error)
		}
		return "", fmt.Errorf("%w: %s answered %d: %s",
			refused, project, resp.StatusCode, truncateForLog(respBody))
	}

	var payload generateResponseBody
	if err := json.Unmarshal(respBody, &payload); err != nil {
		return "", fmt.Errorf("%w: decode response: %v", refused, err)
	}

	// The wire-level completeness checks stay HERE, on the wire type,
	// because they are properties of the /generate response — not
	// something the domain models. Missing paths or a wrong copy count
	// both reduce to ErrGeneratorRefused, which is the shape a handler
	// renders.
	if payload.Sujet == "" || payload.Corrige == "" || payload.Calage == "" {
		return "", fmt.Errorf("%w: worker returned an incomplete response: %+v",
			refused, payload)
	}
	if payload.Copies != copies {
		return "", fmt.Errorf("%w: worker generated %d copies, asked for %d",
			refused, payload.Copies, copies)
	}

	return payload.Sujet, nil
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
var (
	_ controls.Generator = (*Client)(nil)
	_ survey.Generator   = (*Client)(nil)
)

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
