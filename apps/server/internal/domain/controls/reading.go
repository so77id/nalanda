package controls

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// The reading report is engine-independent (ADR-0031) — the same shape survives
// swapping AMC for OMRChecker. Everything below models what the worker's
// /analyse returns, with the failure kinds kept apart because they need
// different repairs.

// RUTStatus is whether the eight-column RUT block was read cleanly.
type RUTStatus string

const (
	// RUTStatusOK: eight digits, one per column, at or above `ticked`.
	RUTStatusOK RUTStatus = "ok"
	// RUTStatusUnreadable: a column is blank or holds more than one digit.
	// Repair: type the eight digits into the review queue.
	RUTStatusUnreadable RUTStatus = "unreadable"
	// RUTStatusNotPresent: WP-F extension, not in the wire report — used on
	// reading rows for copies (copia) that were printed but never captured.
	// The rut_read column is NULL for these; the row exists so the results
	// table has an entry to render as "no rendida".
	RUTStatusNotPresent RUTStatus = "not_present"
)

// CopyStatus collapses what happened to a copy.
type CopyStatus string

const (
	// CopyStatusOK: every answer is `ok` and no page is missing.
	CopyStatusOK CopyStatus = "ok"
	// CopyStatusNeedsReview: at least one answer needs a human.
	CopyStatusNeedsReview CopyStatus = "needs_review"
	// CopyStatusIncomplete: pages this copy printed never reached the
	// scanner. Repair: find the sheet and scan it again.
	CopyStatusIncomplete CopyStatus = "incomplete"
	// CopyStatusNotPresent: WP-F extension, not in the wire report — set by
	// the Service for printed copies (copia rows) that never had a reading.
	// Rendered as "no rendida" and does not count as "corregidas" or
	// "requieren revisión".
	CopyStatusNotPresent CopyStatus = "not_present"
)

// QuestionType is which of AMC's two shapes a question was scored under.
// A question is `simple` if it admits one alternative, `multiple` if several
// (ADR-0031 §A question says which kind it is).
type QuestionType string

const (
	QuestionSimple   QuestionType = "simple"
	QuestionMultiple QuestionType = "multiple"
)

// AnswerStatus is what the reader made of one answer.
type AnswerStatus string

const (
	// AnswerStatusOK: the answer is final, no human needed.
	AnswerStatusOK AnswerStatus = "ok"
	// AnswerStatusBlank: nothing is marked. Repair: a human decides.
	AnswerStatusBlank AnswerStatus = "blank"
	// AnswerStatusAmbiguous: several marks on a `simple` question.
	AnswerStatusAmbiguous AnswerStatus = "ambiguous"
	// AnswerStatusDoubtful: a mark faint enough to worry about.
	AnswerStatusDoubtful AnswerStatus = "doubtful"
)

// Doubtful is one mark below `ticked` but at or above `unsure`, with the
// measured darkness so the review queue can rank them.
type Doubtful struct {
	Answer   int
	Darkness float64
}

// ReportAnswer is one question in a copy's reading.
type ReportAnswer struct {
	Question int          // the layout's question index (used to align with the pool)
	Name     string       // AMC's layout_question.name (bank ref)
	Type     QuestionType // simple | multiple
	Marked   []int        // confident ticks
	Doubtful []Doubtful   // dark-enough marks that did not count
	Status   AnswerStatus
	Score    float64 // engine per-question score
	Max      float64 // 1 for simple; alternative count for multiple
}

// ReportCopy is one copy's reading.
type ReportCopy struct {
	RUT               string
	RUTStatus         RUTStatus
	Answers           []ReportAnswer
	ExpectedQuestions int
	SeenQuestions     int
	MissingQuestions  []string
	Status            CopyStatus
}

// Pages counts what got in.
type Pages struct {
	Captured int
	Failed   int
}

// Scoring names the two thresholds and whether they diverge. `Stale: true`
// means the scores were computed at a different threshold from the one this
// report's marks used — the report and the grade would disagree in silence
// otherwise (ADR-0031 §The report says which threshold).
type Scoring struct {
	Seuil  float64 // what AMC's `note` scored at
	Ticked float64 // what this reading used
	Stale  bool
}

// Report is the whole reply from /analyse or /reanalyse.
type Report struct {
	Pages       Pages
	Scoring     Scoring
	Copies      map[string]ReportCopy // key is the copy number as decimal string, mirroring AMC
	NeedsReview []string
}

// AnalyzeRequest is what a caller hands to Analyzer.Analyze. Every path is
// RELATIVE to the shared work volume, matching Generator's conventions.
type AnalyzeRequest struct {
	Project string // AMC project directory, relative to /work
	ScanPDF string // the batch to read, relative to /work
	Source  string // the .tex the control was generated from, relative to /work
	// Ticked/Unsure (issue #197): the darkness verdicts AND AMC's `note`
	// run at the same Ticked, so marks, scores and the annotated PDF agree
	// on one threshold. Always set by the Service (the control's stored
	// pair or the form's new one); zero is not a valid Ticked and the
	// client refuses it.
	Ticked float64
	Unsure float64
}

// ReanalyzeRequest re-reads the SAME captures at different thresholds.
// Nothing on the paper changes — only the verdict on how dark each box has
// to be to count as a mark.
type ReanalyzeRequest struct {
	Project string
	Ticked  float64 // at or above this the box is a confident mark
	Unsure  float64 // at or above this the box is reported as doubtful
}

// Analyzer is what the controls domain reaches into for the AMC worker's
// scan-reading half. Declared here per §The dependency rule; the amcworker
// package implements it and the amctest package fakes it.
//
// A separate interface from Generator on purpose (see amcworker.Client's
// docstring): analyse is minutes-class and background, generate is
// seconds-class and synchronous, and splitting the two keeps a change to
// one from renaming callers of the other.
type Analyzer interface {
	Analyze(ctx context.Context, req AnalyzeRequest) (Report, error)
	Reanalyze(ctx context.Context, req ReanalyzeRequest) (Report, error)
}

// The failure modes callers branch on. Same shape as ErrGeneratorRefused /
// ErrGeneratorUnavailable so a handler can render an analyse failure the
// same way it renders a generate failure.
var (
	// ErrAnalyzerRefused wraps a failure that came from the worker refusing
	// the request — a 4xx or a report the worker considers invalid (missing
	// scoring, empty layout, damaged PDF).
	ErrAnalyzerRefused = errors.New("controls: the AMC worker refused to analyse")

	// ErrAnalyzerUnavailable wraps a transport failure — the worker is not
	// reachable at all.
	ErrAnalyzerUnavailable = errors.New("controls: the AMC worker is unreachable")
)

// AnalyzerRefusedError carries the fields the analyzer reported alongside
// a refused /analyse or /reanalyse. Callers that only need to branch keep
// using errors.Is(err, ErrAnalyzerRefused); callers that render the
// failure (log, flash, future UI) use errors.As on this type to reach
// Status, Message and Detail without re-parsing the error string.
// Issue #210.
//
// The type is engine-neutral by design: Status is the HTTP status the
// analyzer answered with, Message is the short human summary it chose,
// and Detail is whatever free-form context it attached — an excerpt of
// its own stderr in the current AMC-worker implementation. A future
// non-AMC analyzer (ADR-0031) fills the same fields with whatever
// equivalents it produces.
//
// The struct keeps Detail whole so a future consumer (a debug view, a
// "download the analyzer log" flow) can render it in full; truncation
// for logs and UI is the renderer's concern, not this type's.
//
// The field for the analyzer's short summary is called Message rather
// than Error because Go forbids a struct field and a method to share a
// name, and this type implements the error interface via Error() string.
type AnalyzerRefusedError struct {
	// Status is the HTTP status code the analyzer answered with (a 4xx
	// today), or 0 when the caller did not have one to record. Callers
	// rendering the failure branch on this to distinguish structural
	// refusals (400/422) from ones the analyzer may recover from (503).
	Status int
	// Message is the short human summary the analyzer chose. May be
	// empty when the analyzer answered with a body that did not parse
	// as its error envelope — the caller then only knows the failure
	// was structural.
	Message string
	// Detail is the free-form context the analyzer attached, kept
	// whole. May be empty.
	//
	// SECURITY: never send Detail to slog. See docs/security-notes.md
	// §"The control worker is unauthenticated" — AMC's stderr can name
	// student identifiers verbatim, so this field is for renderers that
	// surface the failure to a human (flash, debug view), not for logs.
	// The type's Error() intentionally does not include Detail, so
	// slog.Warn("...", "error", err) stays clean.
	Detail string
}

// Error satisfies the error interface. Composes Status and Message into
// the same shape pre-#210 callers logged (`worker answered NNN: msg`) so
// existing log parsers keep reading the same text.
func (e *AnalyzerRefusedError) Error() string {
	if e == nil {
		return ErrAnalyzerRefused.Error()
	}
	switch {
	case e.Status != 0 && e.Message != "":
		return fmt.Sprintf("%s: worker answered %d: %s", ErrAnalyzerRefused, e.Status, e.Message)
	case e.Status != 0:
		return fmt.Sprintf("%s: worker answered %d", ErrAnalyzerRefused, e.Status)
	case e.Message != "":
		return ErrAnalyzerRefused.Error() + ": " + e.Message
	default:
		return ErrAnalyzerRefused.Error()
	}
}

// Unwrap returns ErrAnalyzerRefused so errors.Is on the sentinel keeps
// matching. Callers written before #210 do not have to change.
func (e *AnalyzerRefusedError) Unwrap() error { return ErrAnalyzerRefused }

// A Reading is one copy's stored state. WP-F persists this beside the
// existing copia rows; grades are computed on the fly from the answers
// under any overrides.
//
// The identity here is (ControlID, CopyNumber): every copia gets at most
// one reading. ID is the surrogate the answer table and the override
// tables reference — it comes from the store on Upsert.
type Reading struct {
	ID           int64
	ControlID    string
	CopyNumber   int
	RUTRead      *string // nil when unreadable or not present
	RUTStatus    RUTStatus
	Answers      []Answer
	CopyStatus   CopyStatus
	ReadAt       time.Time
	LastEditedAt *time.Time   // set on any manual override
	RUTOverride  *RUTOverride // eagerly loaded by ReadingsByControl and ReadingByCopy
}

// Answer is one question of a Reading, with the engine's numbers beside
// the optional professor override. The natural key is (ReadingID,
// QuestionRef), which is what the override table uses — there is no
// separate answer_id column.
type Answer struct {
	QuestionRef  string       // the bank id resolved from the layout name
	QuestionType QuestionType // never assumed; comes from the report
	Marked       []int
	Doubtful     []Doubtful
	Status       AnswerStatus
	Score        float64
	Max          float64
	Override     *AnswerOverride
}

// AnswerOverride sits BESIDE Answer rather than replacing it, so the UI
// can render both what AMC read and what the professor decided
// (§The domain, note on Override).
type AnswerOverride struct {
	Marked   []int
	Status   AnswerStatus
	EditedAt time.Time
}

// RUTOverride is the professor's typed RUT for a copy whose RUT block was
// unreadable (or one the professor decided to correct).
type RUTOverride struct {
	RUT      string
	EditedAt time.Time
}

// ReadingStore is the persistence side of the reading domain. Declared
// here per §The dependency rule and separate from Store because the two
// families of writes have different transaction shapes — the read half
// of a WP-F flow (upsert a whole report, mark missing copies, load a
// reading with overrides) does not benefit from being wedged into
// CreateControl's atomicity contract.
type ReadingStore interface {
	// UpsertReadingsFromReport persists a Report against controlID. For
	// each copy in the report, the reading row is inserted or updated by
	// (control_id, copy_number). The existing answer rows for that
	// reading are replaced by the report's; the override tables are
	// LEFT INTACT — a re-read must not wipe manual decisions
	// (§Reading with different thresholds).
	UpsertReadingsFromReport(ctx context.Context, controlID string, report Report, now time.Time) error

	// MarkMissingAsNotPresent inserts a reading with copy_status
	// not_present and rut_status not_present for every printed copia
	// row without a reading. Idempotent — a copy that already has a
	// reading is left alone whatever its status.
	MarkMissingAsNotPresent(ctx context.Context, controlID string, now time.Time) error

	// ReadingsByControl returns every reading for a control, ordered
	// by copy_number ascending, with overrides eagerly attached.
	ReadingsByControl(ctx context.Context, controlID string) ([]Reading, error)

	// ReadingByCopy returns one reading (with overrides), or
	// ErrReadingNotFound.
	ReadingByCopy(ctx context.Context, controlID string, copyNumber int) (Reading, error)

	// SetAnswerOverride upserts an override for one (reading,
	// question_ref) and stamps the reading's last_edited_at.
	SetAnswerOverride(ctx context.Context, readingID int64, questionRef string, override AnswerOverride) error

	// ClearAnswerOverride deletes the override for (reading,
	// question_ref), if any.
	ClearAnswerOverride(ctx context.Context, readingID int64, questionRef string) error

	// SetRUTOverride upserts the RUT override for a reading and stamps
	// last_edited_at.
	SetRUTOverride(ctx context.Context, readingID int64, rut string, editedAt time.Time) error

	// ClearRUTOverride deletes the RUT override, if any.
	ClearRUTOverride(ctx context.Context, readingID int64) error

	// SetControlState updates control.state. Named on this interface
	// because the reading half is where the state moves — WP-F flips
	// to InReview on the first upload and to Graded on close.
	SetControlState(ctx context.Context, controlID string, state State) error
}

// ErrReadingNotFound is a lookup that named nothing.
var ErrReadingNotFound = errors.New("controls: no such reading")
