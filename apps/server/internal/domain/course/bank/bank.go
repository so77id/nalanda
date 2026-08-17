// Package bank is the in-memory reader for the published question bank of
// ADR-0032 (questions.json). It exists so the controls domain can resolve a
// section range into a pool of authored questions without parsing MDX or
// touching content/.
//
// The shape here mirrors the emitter in apps/web (src/content/questionBank.ts).
// A shape change is a cross-app breaking change and carries a version field —
// this reader refuses anything but version 1, so drift shows up at boot rather
// than as a subtle misread later.
package bank

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"
)

// Bank is the whole published set, held in memory. Load reads it once at boot
// (cmd/server) and hands the *Bank down; nothing here refreshes at runtime.
// The runtime refresh comes with an apps/web redeploy followed by an
// apps/server redeploy, which is enough at this scale (issue #166 §Bank
// reader).
type Bank struct {
	Version   int
	Documents []Document
	Questions []Question

	// Indices, built by Parse. Not exported: consumers reach them through
	// Pool, FindDocument and DocumentSections, so a rename here does not
	// leak into the callers.
	docIndex     map[string]int
	sectionIndex map[SectionRef]int
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

// FetchTimeout bounds a boot fetch. Long enough to survive a slow start on
// GitHub Pages, short enough that a completely dead URL fails the boot
// rather than hanging it. It is the boot budget, not a request-time budget:
// nothing refreshes the bank at runtime, so a slow fetch here is a slow
// server start and not a slow user request.
const FetchTimeout = 30 * time.Second

// The failure modes callers branch on, wrapped so a caller can tell them
// apart with errors.Is without importing json or net/http.
var (
	// ErrUnsupportedScheme wraps a Load call whose URL is neither http, https
	// nor file. The design closed transport in ADR-0032 §C14; this refuses to
	// widen it by accident.
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

// Load fetches the bank from URL and parses it. Blocking, once, at boot.
//
// http/https use the default client with a bounded context; file:// is opened
// against the local filesystem. A path escape check would be the wrong
// mitigation here: the URL is operator-supplied at boot and reaching it is
// the operator's decision, exactly like NALANDA_DATABASE_URL.
func Load(ctx context.Context, rawURL string) (*Bank, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("bank: parse URL %q: %w", rawURL, err)
	}
	switch parsed.Scheme {
	case "http", "https":
		return loadHTTP(ctx, rawURL)
	case "file":
		// url.Parse folds a file:/// path into .Path. Empty means the URL was
		// nothing after the scheme, which is not a location we can open.
		if parsed.Path == "" {
			return nil, fmt.Errorf("bank: file URL %q names no path", rawURL)
		}
		return loadFile(parsed.Path)
	default:
		return nil, fmt.Errorf("%w: got %q in %s", ErrUnsupportedScheme, parsed.Scheme, rawURL)
	}
}

func loadHTTP(ctx context.Context, u string) (*Bank, error) {
	ctx, cancel := context.WithTimeout(ctx, FetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("bank: build request for %s: %w", u, err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("bank: fetch %s: %w", u, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bank: %s answered %s", u, resp.Status)
	}
	// The bank is small (kilobytes); anything approaching this cap is a wrong
	// URL pointing at the whole site rather than the artifact.
	const maxRead = 32 << 20
	return Parse(io.LimitReader(resp.Body, maxRead))
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
		Version:      raw.Version,
		Documents:    make([]Document, 0, len(raw.Documents)),
		Questions:    make([]Question, 0, len(raw.Questions)),
		docIndex:     make(map[string]int, len(raw.Documents)),
		sectionIndex: make(map[SectionRef]int, len(raw.Documents)*4),
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
	for _, q := range raw.Questions {
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
