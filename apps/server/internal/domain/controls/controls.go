// Package controls is the entrance-controls domain: a professor picks a range
// of the published question bank, the server draws a pool from it and asks the
// AMC worker to generate copies (docs/design/2026-08-controles.md, WP-E).
//
// This file holds the interfaces the domain consumes and the small value
// types the whole package shares. The .tex generator and the Service live
// beside it (S4, S5). The dependency rule is the same one that governs the
// auth domain: the interfaces are declared HERE because that is where they
// are consumed, and infra implements them (backend-code-style.md §The
// dependency rule).
package controls

import (
	"context"
	"errors"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// State is the lifecycle position of a Control. WP-E creates a row at
// Generated; WP-F moves it to InReview when scans arrive and to Graded when
// the professor closes the correction.
type State string

const (
	// Generated: the PDF is on disk and the row is committed. No scans yet.
	Generated State = "generated"
	// InReview: WP-F loaded scans; some copies may need a human.
	InReview State = "in_review"
	// Graded: the professor closed the correction.
	Graded State = "graded"
)

// A Control is one printed entrance quiz. Fields mirror the V1 data model in
// docs/design/2026-08-controles.md §Data model, minus curso_id (WP-D's) and
// plus what the domain needs (id as text, CreatedBy for audit).
type Control struct {
	ID               string
	Name             string
	ApplicationDate  *time.Time // nil means "no date declared"
	RangeFrom        bank.SectionRef
	RangeTo          bank.SectionRef
	QuestionsPerCopy int
	Copies           int
	State            State
	CreatedAt        time.Time
	CreatedBy        int64 // users.user_id
}

// PoolEntry is one authored question that was actually drawn from at
// generation time, in the order it was drawn in. The pair (ControlID, Ref)
// is unique, and WP-F reads this table to know which bank question each
// answer maps back to.
type PoolEntry struct {
	Ref   string // the question id in the bank
	Order int    // 0-based position in the drawn pool
}

// A Copy is one printed sheet identity. WP-E writes one row per copy at
// generation time; WP-F later attaches lectura/respuesta rows to them.
type Copy struct {
	ControlID string
	Numero    int // 1-based, matches AMC's printed \onecopy index
}

// Store is what the controls Service (S5) reaches into for persistence.
// Declared in the domain per §The dependency rule: an interface lives where
// it is consumed, and infra implements it.
//
// The unit of work here is a whole control — the row plus its pool plus its
// copies land atomically or not at all (§Failure modes: "creation is
// all-or-nothing"). Splitting it into per-table methods would push the
// atomicity contract onto every caller.
type Store interface {
	// CreateControl writes the control, its pool entries and its copies in
	// one transaction. Fails atomically: no rows are left behind on any
	// failure, and no partial control ever appears in ListControls.
	CreateControl(ctx context.Context, control Control, pool []PoolEntry) error

	// ControlByID returns the control with this id, or ErrControlNotFound.
	ControlByID(ctx context.Context, id string) (Control, error)

	// ListControls returns every control, ordered by application date
	// descending — with nulls last, so a "no date declared" row does not
	// hide freshly generated controls. Created-at ties break within a date.
	ListControls(ctx context.Context) ([]Control, error)

	// ControlPool returns the pool drawn for this control, in the order it
	// was drawn. Exposed for WP-F; WP-E writes and never reads it back.
	ControlPool(ctx context.Context, controlID string) ([]PoolEntry, error)
}

// Generator asks the AMC worker to compile a .tex into printable PDFs.
//
// The interface is one method because that is all the domain wants of it:
// give a project directory, a source path and a copy count, get back the
// asset paths AMC produced. The AMC worker's contract carries more surface
// (analyse, associate, annotate) — those belong to WP-F and G and would only
// couple this domain to a shape it does not use yet.
//
// The paths returned live under the shared volume (NALANDA_WORK_DIR); they
// are relative to it so the domain never handles a container-visible absolute
// path.
type Generator interface {
	Generate(ctx context.Context, req GenerateRequest) (Assets, error)
}

// GenerateRequest names what a call needs. A struct rather than positional
// arguments so a new field (a seed, a language) does not renumber every call
// site (backend-code-style.md §HTTP, same reason web.Deps is a struct).
type GenerateRequest struct {
	// Project is the AMC project directory, RELATIVE to the work volume. It
	// must exist and be writable by the worker before Generate is called; the
	// Service creates it as controls/<id>/.
	Project string
	// Source is the .tex to compile, RELATIVE to the work volume. It must
	// live under Project's inputs/ subtree (staging is what makes
	// \lstinputlisting resolve, ADR-0033).
	Source string
	// Copies is the number of printed sheets. Must be positive.
	Copies int
}

// Assets is what a successful Generate returns: the paths AMC wrote and the
// copy count it confirms. Paths are relative to the work volume so a caller
// can join them with either the local mount (server side) or /work (worker
// side) without translation.
type Assets struct {
	// Sujet is the printable subject PDF, one per class, staged for printing
	// (the professor's headline deliverable).
	Sujet string
	// Corrige is the answer key AMC produces alongside sujet.pdf. Handed to
	// the professor as a second download, and read by WP-F for grading.
	Corrige string
	// Calage is AMC's per-copy layout, needed by WP-F to know where each box
	// landed. WP-E writes it to disk and never reads it back.
	Calage string
	// Copies is what the worker confirmed as generated. A mismatch with the
	// requested count is treated as a generation failure by the Service.
	Copies int
}

// The failure modes callers branch on. Wrapped so a handler can render a
// domain answer in Spanish without importing the store or the client.
var (
	// ErrControlNotFound is a lookup that named nothing here.
	ErrControlNotFound = errors.New("controls: no such control")

	// ErrGeneratorRefused wraps a failure that came from the worker refusing
	// the request — a 4xx, or a response naming a missing file. Callers
	// branch on it with errors.Is when they want to distinguish an
	// operator-caused failure (worker down, wrong URL) from a request-shaped
	// one (a pool that somehow produced an empty PDF).
	ErrGeneratorRefused = errors.New("controls: the AMC worker refused the request")

	// ErrGeneratorUnavailable wraps a failure that could not reach the worker
	// at all — connection refused, DNS, timeout without a response. Same
	// shape as the pair above, so a handler can render the two the same way
	// while a future operator dashboard can tell them apart.
	ErrGeneratorUnavailable = errors.New("controls: the AMC worker is unreachable")
)
