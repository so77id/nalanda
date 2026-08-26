// Package bank is the in-memory reader for the published question bank of
// ADR-0032 (questions.json). It exists so the controls domain can resolve a
// section range into a pool of authored questions without parsing MDX or
// touching content/.
//
// The shape here mirrors the emitter in apps/web (src/content/questionBank.ts).
// A shape change is a cross-app breaking change and carries a version field —
// this reader refuses anything but version 1, so drift shows up at boot rather
// than as a subtle misread later.
//
// Since issue #230 the bank is served through LiveBank rather than a bare
// *Bank pointer: apps/web is the source of truth, and this reader now
// rotates its in-memory snapshot when apps/web publishes a new
// questions.json. NewLive performs the boot fetch and returns the wrapper;
// callers rotate it via Reload (with 304 semantics) and get the current
// snapshot via Get, which never holds a lock on the read path.
package bank

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

// Bank is the whole published set, held in memory. NewLive reads it once at
// boot (cmd/server) and hands a *LiveBank down; Reload rotates the *Bank
// atomically at runtime (issue #230).
type Bank struct {
	Version   int
	Documents []Document
	Questions []Question

	// Indices, built by Parse. Not exported: consumers reach them through
	// Pool, FindDocument, FindQuestion and DocumentSections, so a rename
	// here does not leak into the callers.
	docIndex      map[string]int
	sectionIndex  map[SectionRef]int
	questionIndex map[string]int
}

// Document is one course document as the emitter published it: id, title, the
// "coverage" phrase apps/web renders, and its section slugs in document order.
type Document struct {
	ID       string
	Title    string
	Coverage string
	Sections []string
}

// Question is one authored question. Anchor is the section slug, empty when
// the source declared it null (a question that belongs to no section is
// unreachable from a range pool — see Pool).
type Question struct {
	ID           string
	Document     string
	Anchor       string
	Type         string
	Statement    string
	Code         *Code
	Alternatives []string
	Correct      []int
}

// Type constants. Derived from the marks in the emitter; the reader here
// consumes the derived value.
const (
	TypeSimple   = "simple"
	TypeMultiple = "multiple"
)

// Code is a listing attached to a question, kept as its own field so nothing
// has to be escaped (ADR-0032). Nil when the question carries no code.
type Code struct {
	Language string
	Source   string
}

// SectionRef names a section within a document, using the two slugs the
// bank publishes. It is the pair the range dropdowns emit.
type SectionRef struct {
	Document string
	Section  string
}

// FetchTimeout bounds a single fetch. Long enough to survive a slow start
// on GitHub Pages, short enough that a completely dead URL fails one
// refresh cycle rather than hanging it. Applied both at boot (NewLive) and
// on every subsequent Reload.
const FetchTimeout = 30 * time.Second

// The failure modes callers branch on, wrapped so a caller can tell them
// apart with errors.Is without importing json or net/http.
var (
	// ErrUnsupportedScheme wraps a URL whose scheme is neither http, https
	// nor file. The design closed transport in ADR-0032 §C14; this refuses
	// to widen it by accident.
	ErrUnsupportedScheme = errors.New("bank: URL scheme must be http, https or file")

	// ErrUnsupportedVersion is a bank with a version this reader does not know
	// how to read. Version is what ADR-0032 promised would fail loudly.
	ErrUnsupportedVersion = errors.New("bank: unsupported version")

	// ErrEmptyRange is Pool's answer when the range resolves to zero
	// questions. The form turns it into a Spanish message; the domain sees a
	// sentinel.
	ErrEmptyRange = errors.New("bank: the range contains no questions")

	// ErrRangeInverted is Pool's answer when the "to" edge precedes "from" in
	// the reading order — a form defect, not a bank one.
	ErrRangeInverted = errors.New("bank: the range goes backwards through the reading order")

	// ErrUnknownDocument / ErrUnknownSection are Pool's answers when the
	// dropdowns emitted a value the bank does not know. The form flags the
	// offending field.
	ErrUnknownDocument = errors.New("bank: unknown document")
	ErrUnknownSection  = errors.New("bank: unknown section")

	// ErrDuplicateQuestionID is a bank whose Parse found the same
	// question id twice. ADR-0032 §Consequences names this "a duplicate
	// question id fails the BUILD, deliberately unlike the rest of the
	// gate ladder — the id is the join key, and a duplicate silently
	// merges two students' answers into one column". The emitter in
	// apps/web already enforces it at build time; this reader mirrors
	// that rule so a bank JSON handed to a server that skipped the build
	// gate is still rejected at boot rather than at the first control's
	// PRIMARY KEY conflict on control_pregunta.
	ErrDuplicateQuestionID = errors.New("bank: duplicate question id")
)

// errNotModified is the private sentinel fetch returns when a conditional
// GET was answered 304. Reload consumes it and returns (updated=false,
// err=nil): "the source is unchanged" is not a failure a caller wants to
// distinguish from a successful refresh, it is just quieter.
var errNotModified = errors.New("bank: not modified")

// LiveBank wraps a *Bank so the boot snapshot can be swapped at runtime
// without a lock on the read path.
//
// The published questions.json (ADR-0032) is the source of truth. Since
// issue #230 the server refreshes its in-memory bank on a schedule
// (background ticker, S2) and via a manual admin endpoint (S3); the swap
// is atomic, and a failed refresh preserves the current snapshot rather
// than nilling it out — a network flap or a bad publish must not leave
// the server serving nothing.
//
// A pointer captured by a reader before a Reload keeps naming the previous
// snapshot: the atomic pointer rotates, the *Bank it points at does not
// mutate. That is what makes concurrent requests safe without locking the
// read path.
type LiveBank struct {
	url    string
	logger *slog.Logger

	// static is set by NewStaticLive; Reload is a no-op on a static bank.
	// This is a test seam other packages need (their handler/service
	// constructors take a *LiveBank now).
	static bool

	snap atomic.Pointer[Bank]

	// reloadMu serializes Reload so a manual click that races the ticker
	// does not send two GETs and race the two Stores against each other.
	// NEVER held while a reader calls Get() — readers touch snap and
	// nothing else.
	reloadMu     sync.Mutex
	lastModified string // guarded by reloadMu
}

// NewLive fetches the bank once and returns a LiveBank whose Get() serves
// that snapshot. Callers wire the background refresh (via Watch) and/or
// the manual admin endpoint separately.
//
// A boot failure is a startup failure, deliberately: the same rule Load
// followed. An operator sees "questions.json refused to load" immediately
// rather than as a first-request failure later.
func NewLive(ctx context.Context, rawURL string, logger *slog.Logger) (*LiveBank, error) {
	if logger == nil {
		return nil, errors.New("bank: NewLive requires a logger")
	}
	lb := &LiveBank{url: rawURL, logger: logger}
	b, lastMod, err := lb.fetch(ctx, "")
	if err != nil {
		return nil, err
	}
	lb.snap.Store(b)
	lb.lastModified = lastMod
	logger.Info("question bank loaded",
		"url", rawURL,
		"documents", len(b.Documents),
		"questions", len(b.Questions),
	)
	return lb, nil
}

// NewStaticLive wraps a parsed Bank in a LiveBank whose Reload is a no-op.
//
// It exists for tests in other packages that hand a fixed bank into
// constructors that take a *LiveBank now; production code goes through
// NewLive. Its logger discards output — tests that need to observe log
// lines build their own *LiveBank against httptest.
func NewStaticLive(b *Bank) *LiveBank {
	lb := &LiveBank{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		static: true,
	}
	lb.snap.Store(b)
	return lb
}

// Get returns the current bank snapshot. Never nil once NewLive returned;
// a reader may hold the pointer past a subsequent Reload and keep seeing
// the same snapshot.
func (lb *LiveBank) Get() *Bank {
	return lb.snap.Load()
}

// URL returns the URL this bank was loaded from. Handlers use it in log
// lines that report a manual refresh outcome.
func (lb *LiveBank) URL() string {
	return lb.url
}

// Reload attempts to refresh the bank in place. It returns:
//
//   - (true, nil)  the server answered 200 and the snapshot was swapped.
//   - (false, nil) the server answered 304, or this is a static bank — nothing to do.
//   - (false, err) the fetch or parse failed; the current snapshot is preserved.
//
// A failure is a WARN in the logger: an operator reading logs sees which
// refresh failed and why, and the server keeps serving the last known
// good bank. A successful update is an INFO with document + question
// counts, so a comparison across boots is one grep away.
func (lb *LiveBank) Reload(ctx context.Context) (bool, error) {
	if lb.static {
		return false, nil
	}

	lb.reloadMu.Lock()
	defer lb.reloadMu.Unlock()

	b, lastMod, err := lb.fetch(ctx, lb.lastModified)
	if err != nil {
		if errors.Is(err, errNotModified) {
			lb.logger.Debug("question bank unchanged", "url", lb.url)
			return false, nil
		}
		lb.logger.Warn("question bank refresh failed", "url", lb.url, "error", err)
		return false, err
	}
	lb.snap.Store(b)
	lb.lastModified = lastMod
	lb.logger.Info("bank refreshed",
		"url", lb.url,
		"documents", len(b.Documents),
		"questions", len(b.Questions),
	)
	return true, nil
}

// Watch calls Reload on interval until ctx is done. A zero or negative
// interval returns immediately — the operator's opt-out, wired through
// NALANDA_BANK_REFRESH_INTERVAL. Errors surface through the logger:
// Reload already logs a Warn on failure and Info on a real update, so
// this loop cannot itself add a signal a caller would react to.
//
// A static bank (built by NewStaticLive for tests) has no source to poll,
// so Watch is a no-op there.
func (lb *LiveBank) Watch(ctx context.Context, interval time.Duration) {
	if interval <= 0 || lb.static {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, _ = lb.Reload(ctx)
		}
	}
}

// fetch reads the bank from lb.url. ifModifiedSince, when non-empty, is
// sent as If-Modified-Since; the server may then answer 304, and fetch
// returns errNotModified with a nil *Bank. The returned lastModified is
// the header the next call should echo back — empty for file:// (which
// re-parses every call, since it is a dev-only scheme per
// NALANDA_QUESTIONS_JSON_URL docs) or for an HTTP response without the
// header.
func (lb *LiveBank) fetch(ctx context.Context, ifModifiedSince string) (*Bank, string, error) {
	parsed, err := url.Parse(lb.url)
	if err != nil {
		return nil, "", fmt.Errorf("bank: parse URL %q: %w", lb.url, err)
	}
	switch parsed.Scheme {
	case "http", "https":
		return fetchHTTP(ctx, lb.url, ifModifiedSince)
	case "file":
		if parsed.Path == "" {
			return nil, "", fmt.Errorf("bank: file URL %q names no path", lb.url)
		}
		b, err := loadFile(parsed.Path)
		return b, "", err
	default:
		return nil, "", fmt.Errorf("%w: got %q in %s", ErrUnsupportedScheme, parsed.Scheme, lb.url)
	}
}

func fetchHTTP(ctx context.Context, u, ifModifiedSince string) (*Bank, string, error) {
	ctx, cancel := context.WithTimeout(ctx, FetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, "", fmt.Errorf("bank: build request for %s: %w", u, err)
	}
	if ifModifiedSince != "" {
		req.Header.Set("If-Modified-Since", ifModifiedSince)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("bank: fetch %s: %w", u, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNotModified {
		return nil, "", errNotModified
	}
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("bank: %s answered %s", u, resp.Status)
	}
	// The bank is small (kilobytes); anything approaching this cap is a wrong
	// URL pointing at the whole site rather than the artifact.
	const maxRead = 32 << 20
	b, err := Parse(io.LimitReader(resp.Body, maxRead))
	if err != nil {
		return nil, "", err
	}
	return b, resp.Header.Get("Last-Modified"), nil
}

func loadFile(path string) (*Bank, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("bank: open %s: %w", path, err)
	}
	defer func() { _ = f.Close() }()
	return Parse(f)
}

// Parse decodes a bank from r. Exposed so tests and the operator's local
// tooling can round-trip a JSON blob without the URL layer.
func Parse(r io.Reader) (*Bank, error) {
	var raw jsonBank
	dec := json.NewDecoder(r)
	if err := dec.Decode(&raw); err != nil {
		return nil, fmt.Errorf("bank: decode: %w", err)
	}
	if raw.Version != 1 {
		return nil, fmt.Errorf("%w: got %d, this reader knows 1", ErrUnsupportedVersion, raw.Version)
	}

	b := &Bank{
		Version:       raw.Version,
		Documents:     make([]Document, 0, len(raw.Documents)),
		Questions:     make([]Question, 0, len(raw.Questions)),
		docIndex:      make(map[string]int, len(raw.Documents)),
		sectionIndex:  make(map[SectionRef]int, len(raw.Documents)*4),
		questionIndex: make(map[string]int, len(raw.Questions)),
	}
	for i, d := range raw.Documents {
		b.Documents = append(b.Documents, Document{
			ID:       d.ID,
			Title:    d.Title,
			Coverage: d.Coverage,
			Sections: append([]string(nil), d.Sections...),
		})
		b.docIndex[d.ID] = i
		for j, s := range d.Sections {
			b.sectionIndex[SectionRef{Document: d.ID, Section: s}] = j
		}
	}
	seenID := make(map[string]bool, len(raw.Questions))
	for i, q := range raw.Questions {
		if seenID[q.ID] {
			return nil, fmt.Errorf("%w: %q", ErrDuplicateQuestionID, q.ID)
		}
		seenID[q.ID] = true

		anchor := ""
		if q.Anchor != nil {
			anchor = *q.Anchor
		}
		b.Questions = append(b.Questions, Question{
			ID:           q.ID,
			Document:     q.Document,
			Anchor:       anchor,
			Type:         q.Type,
			Statement:    q.Statement,
			Code:         q.Code.toCode(),
			Alternatives: append([]string(nil), q.Alternatives...),
			Correct:      append([]int(nil), q.Correct...),
		})
		b.questionIndex[q.ID] = i
	}
	return b, nil
}

// Pool returns the questions inside the section range (from, to), inclusive
// at both ends, in the source order the bank publishes.
//
// The source order IS the reading order, because the emitter walks documents
// in index.yaml reading order and within each document walks the file in
// authoring order (apps/web src/content/questionBank.ts). Preserving that
// order in the pool is what ADR-0030's four silent traps need to be testable
// against a deterministic input.
//
// A question whose anchor is empty (declared null in the source) is skipped:
// a range is expressed in terms of sections, so a question that belongs to
// none has no membership to decide.
func (b *Bank) Pool(from, to SectionRef) ([]Question, error) {
	fromDoc, ok := b.docIndex[from.Document]
	if !ok {
		return nil, fmt.Errorf("%w: from=%q", ErrUnknownDocument, from.Document)
	}
	toDoc, ok := b.docIndex[to.Document]
	if !ok {
		return nil, fmt.Errorf("%w: to=%q", ErrUnknownDocument, to.Document)
	}
	fromSec, ok := b.sectionIndex[from]
	if !ok {
		return nil, fmt.Errorf("%w: from=%q in document %q", ErrUnknownSection, from.Section, from.Document)
	}
	toSec, ok := b.sectionIndex[to]
	if !ok {
		return nil, fmt.Errorf("%w: to=%q in document %q", ErrUnknownSection, to.Section, to.Document)
	}
	if fromDoc > toDoc || (fromDoc == toDoc && fromSec > toSec) {
		return nil, ErrRangeInverted
	}

	inRange := func(doc, sec int) bool {
		if doc < fromDoc || doc > toDoc {
			return false
		}
		if doc == fromDoc && sec < fromSec {
			return false
		}
		if doc == toDoc && sec > toSec {
			return false
		}
		return true
	}

	var pool []Question
	for _, q := range b.Questions {
		if q.Anchor == "" {
			continue
		}
		docIdx, ok := b.docIndex[q.Document]
		if !ok {
			continue
		}
		secIdx, ok := b.sectionIndex[SectionRef{Document: q.Document, Section: q.Anchor}]
		if !ok {
			continue
		}
		if inRange(docIdx, secIdx) {
			pool = append(pool, q)
		}
	}
	if len(pool) == 0 {
		return nil, ErrEmptyRange
	}
	return pool, nil
}

// FindDocument returns the Document with id, and whether it exists. Handlers
// use it to validate a form value before Pool sees it.
func (b *Bank) FindDocument(id string) (Document, bool) {
	i, ok := b.docIndex[id]
	if !ok {
		return Document{}, false
	}
	return b.Documents[i], true
}

// HasSection reports whether ref exists in the bank. Used by the form to
// tell a bad section from a bad range before calling Pool.
func (b *Bank) HasSection(ref SectionRef) bool {
	_, ok := b.sectionIndex[ref]
	return ok
}

// FindQuestion returns the Question with id, and whether it exists.
// WP-F's review page needs statement + alternatives together per rendered
// question; the old code walked b.Questions twice per row.
func (b *Bank) FindQuestion(id string) (Question, bool) {
	i, ok := b.questionIndex[id]
	if !ok {
		return Question{}, false
	}
	return b.Questions[i], true
}

// --- JSON shape --------------------------------------------------------------
//
// Kept lowercase and package-private because it is a wire shape, not a domain
// value: consumers see the Bank/Document/Question types above, which do not
// carry the *string anchor of the wire.

type jsonBank struct {
	Version   int            `json:"version"`
	Documents []jsonDoc      `json:"documents"`
	Questions []jsonQuestion `json:"questions"`
}

type jsonDoc struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Coverage string   `json:"coverage"`
	Sections []string `json:"sections"`
}

type jsonQuestion struct {
	ID           string    `json:"id"`
	Document     string    `json:"document"`
	Anchor       *string   `json:"anchor"`
	Type         string    `json:"type"`
	Statement    string    `json:"statement"`
	Code         *jsonCode `json:"code"`
	Alternatives []string  `json:"alternatives"`
	Correct      []int     `json:"correct"`
}

type jsonCode struct {
	Language string `json:"language"`
	Source   string `json:"source"`
}

func (c *jsonCode) toCode() *Code {
	if c == nil {
		return nil
	}
	return &Code{Language: c.Language, Source: c.Source}
}
