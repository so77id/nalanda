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
