package survey

import (
	"context"
	"errors"
)

// The survey domain's view of the AMC worker (issue #310, ADR-0078): its
// own request and result types and its own sentinels, implemented by
// internal/infra/amcworker beside — never through — the controls' ones.

// GenerateRequest is one /generate of a run's sheet. Paths are relative to
// the worker's /work volume.
type GenerateRequest struct {
	Project string
	Source  string
	Copies  int
}

// Assets is what a generation produced, relative to /work.
type Assets struct {
	Sujet string
}

// Generator compiles a run's sheet.
type Generator interface {
	GenerateSheet(ctx context.Context, req GenerateRequest) (Assets, error)
}

// Worker sentinels.
var (
	// ErrGeneratorRefused is the worker (or AMC) refusing the source — a
	// LaTeX error, a malformed request. Retrying the same input fails the
	// same way.
	ErrGeneratorRefused = errors.New("survey: the worker refused to generate the sheet")
	// ErrGeneratorUnavailable is the worker not answering. Retrying later
	// may work.
	ErrGeneratorUnavailable = errors.New("survey: the worker is unavailable")
)

// Reading (issue #311). The worker's /analyse on a survey sheet reports
// what it reports for a control — the survey reads only the per-answer
// part of it (ADR-0080 §8: with no ID grid every copy is `needs_review`,
// so the copy's status, RUT and score mean nothing here).

// Thresholds a survey's scans are read at: the controls' product defaults
// (darkness above DefaultTicked is a mark, between DefaultUnsure and it is
// doubtful). Fixed — re-reading at another sensitivity is #313.
const (
	DefaultTicked = 0.15
	DefaultUnsure = 0.05
)

// AnalyzeRequest is one /analyse of a run's uploaded batch. Paths are
// relative to the worker's /work volume.
type AnalyzeRequest struct {
	Project string
	ScanPDF string
	Source  string
	Ticked  float64
	Unsure  float64
}

// AnswerStatus is the reader's verdict on one answer of one copy.
type AnswerStatus string

const (
	AnswerOK        AnswerStatus = "ok"
	AnswerBlank     AnswerStatus = "blank"
	AnswerAmbiguous AnswerStatus = "ambiguous"
	AnswerDoubtful  AnswerStatus = "doubtful"
)

// Report is what a batch's /analyse read, in survey terms.
type Report struct {
	// Batch is what THIS run of /analyse did; the adapter fills it in for
	// a worker that predates the field.
	Batch  *Batch
	Copies []ReportCopy
}

// Batch is one /analyse run's own outcome (single-mode capture, #298).
type Batch struct {
	Captured int
	Failed   int
	// RecapturedCopies are copies this batch scanned again, replacing
	// what an earlier batch read for them.
	RecapturedCopies []int
}

// ReportCopy is one captured sheet.
type ReportCopy struct {
	CopyNumber int
	Pages      []int
	Answers    []ReportAnswer
}

// ReportAnswer is one question on one sheet. Marked and Doubtful are
// AMC's answer numbers: 1-based positions in the SOURCE order, which is
// the bank's order because the sheet is unshuffled (tex `[o]`).
type ReportAnswer struct {
	// Name is the AMC question name, q<question id> (tex.QuestionName).
	Name     string
	Status   AnswerStatus
	Marked   []int
	Doubtful []int
}

// Analyzer reads a run's scans on the AMC worker.
type Analyzer interface {
	AnalyzeSheets(ctx context.Context, req AnalyzeRequest) (Report, error)
}

// Reader sentinels.
var (
	// ErrAnalyzerRefused is the worker refusing the batch or its request.
	ErrAnalyzerRefused = errors.New("survey: the worker refused to read the scans")
	// ErrAnalyzerUnavailable is the worker not answering.
	ErrAnalyzerUnavailable = errors.New("survey: the scan reader is unavailable")
	// ErrNothingCaptured is a batch AMC recognised no page of — single-mode
	// AMC exits 0 on it, so this count is the only loud signal (#298).
	ErrNothingCaptured = errors.New("survey: the batch had no page of this run")
	// ErrReportMismatch is a report naming a question or an alternative
	// the run never printed: the scans are not of this run's sheet.
	ErrReportMismatch = errors.New("survey: the reading does not match the run's sheet")
)
