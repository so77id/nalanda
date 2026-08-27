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
	// DuplexPadding, when true, tells the tex generator to emit
	// \AMCcleardoublepage inside \onecopy so each copy pads to an even
	// page count for duplex printing. False emits \clearpage instead —
	// one page per copy, no blank filler. Issue #185. The default at the
	// SQL level is 1 (padded) so pre-migration controls stay padded, but
	// every caller in Go passes an explicit value.
	DuplexPadding bool
	// Paper is the physical sheet the printed PDF is laid out for
	// (issue #208, ADR-0043). Two values today: PaperLetter (default, the
	// Chilean printer default from ADR-0042) and PaperA4. The generator
	// reads this into \documentclass; the professor picks it in `<details>
	// Opciones avanzadas` on the create form, so the default requires no
	// interaction and the alternative asks for one.
	Paper Paper
	// Ticked/Unsure are the darkness thresholds this control's batches are
	// read and scored at (issue #197). One pair per control, last-wins:
	// the upload form can set them, the reanalyse form re-sets them, and
	// the worker uses the same ticked for the reader, note and the
	// annotated PDF. The zero value is not a valid pair; Create writes the
	// product defaults below.
	Ticked    float64
	Unsure    float64
	State     State
	CreatedAt time.Time
	CreatedBy int64 // users.user_id
}

// Paper is the physical sheet a control's PDF is laid out for. The two
// enumerated values map 1-1 to the two \documentclass options the generator
// supports (issue #208, ADR-0043). New values are added here, in the SQL
// CHECK constraint in migrations/00009_paper.sql, and in the generator's
// preamble switch — all three or none.
type Paper string

const (
	// PaperLetter is US Letter (8.5×11 in, 2550×3300 px @ 300 dpi). The
	// Chilean printer default and this repo's operational default.
	PaperLetter Paper = "letter"
	// PaperA4 is A4 (210×297 mm, 2480×3508 px @ 300 dpi). Available when
	// the professor explicitly asks for it under "Opciones avanzadas".
	PaperA4 Paper = "a4"
	// DefaultPaper is what the create form initialises Paper to, what the
	// migration sets NULL rows to, and what Service.PrepareControl
	// writes on any call that omits the field.
	DefaultPaper = PaperLetter
)

// ValidPaper reports whether p is one of the two enumerated values. Handlers
// use it to reject an unknown form value before it reaches the schema's
// CHECK (which would refuse it too, one gate later).
func ValidPaper(p Paper) bool {
	return p == PaperLetter || p == PaperA4
}

// DefaultTicked / DefaultUnsure are the product defaults for a newly
// generated control (issue #197). Measured on a real batch (Jetson
// 2026-08-19): pencil X marks read 0.14-0.32 darkness, painted squares
// 0.62-1.00, empty boxes ~0.0 — the previous 0.30 cut through the X band.
// 0.15 reads every X except the faintest tail, which lands in the
// doubtful band (0.05-0.15) and stays visible in needs_review.
const (
	DefaultTicked = 0.15
	DefaultUnsure = 0.05
)

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

// AnnotatedCopy is the record of an anotado PDF the worker produced for one
// copia. The PDF itself lives on the shared volume at Path (relative to the
// server's WorkDir); this row only tracks that it exists and when it was
// generated (issue #190, ADR-0030 §Not yet proven → the pipeline that closes
// the paper flow's last step).
type AnnotatedCopy struct {
	ControlID   string
	CopyNumber  int
	GeneratedAt time.Time
	// Path is relative to the server's WorkDir. Absolute on the worker side
	// is <WorkerWorkDir>/<Path>. Same convention as the sujet.pdf and scan
	// image paths.
	Path string
}

// Store is what the controls Service reaches into for persistence.
// Declared in the domain per §The dependency rule: an interface lives
// where it is consumed, and infra implements it.
//
// The unit of work here is a whole control — the row plus its pool plus
// its copies land atomically or not at all (§Failure modes: "creation is
// all-or-nothing"). Splitting it into per-table methods would push the
// atomicity contract onto every caller.
//
// The method set is deliberately what THIS WP calls. `controlstore.Store`
// also exposes ControlPool, unregistered here on purpose: WP-F is where
// the pool is read back for grading, and adding it now with no reader
// would be a Java-shaped interface (backend-code-style.md §The dependency
// rule) whose consumer's needs cannot yet shape it.
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

	// RecordAnnotated writes (or replaces) the anotado PDF record for one
	// copia. UPSERT on the compound PK (control_id, copy_number) — a
	// re-annotation replaces the row rather than growing history, so the
	// review page always sees the latest one (issue #190).
	RecordAnnotated(ctx context.Context, a AnnotatedCopy) error

	// AnnotatedByCopy returns the anotado PDF record for one copia, or
	// exists=false when the copia has not been annotated yet — the review
	// page's cue to fall back to the raw scan (issue #190).
	AnnotatedByCopy(ctx context.Context, controlID string, copyNumber int) (AnnotatedCopy, bool, error)

	// ClearAnnotated deletes every anotado record for a control. The
	// review page then falls back to the raw scan everywhere; used when
	// the stored PDFs can no longer agree with the readings (issue #190:
	// Reanalyze re-reads at new thresholds and invalidates the old
	// drawings).
	ClearAnnotated(ctx context.Context, controlID string) error

	// SetControlThresholds persists the darkness pair a batch was read
	// at (issue #197). Last-wins: each upload and each reanalyse writes
	// the pair it used, and Annotate reads it back so the PDFs agree.
	SetControlThresholds(ctx context.Context, controlID string, ticked, unsure float64) error
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

// Assets is what a successful Generate returns: the printable sujet the
// Service checks on disk before committing the row. The worker also produces
// corrige.pdf and calage.xy in the same out/ directory, but WP-E never reads
// them after generation — the download handlers (SujetPath, CorrigePath)
// re-derive them from ProjectDir. WP-F will read them off the same
// convention (see the ADR-0033 note next to ProjectDir).
//
// The narrower value here is the whole point: adding Corrige/Calage/Copies
// as domain fields with no reader made them a shape a maintainer had to
// keep in step with a worker they never see; the amcworker client keeps
// its own non-empty checks on the wire response and does not need this
// domain type to carry them.
type Assets struct {
	// Sujet is the sujet.pdf path relative to the work volume, so a caller
	// can join it with either the local mount (server side) or /work
	// (worker side) without translation.
	Sujet string
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
