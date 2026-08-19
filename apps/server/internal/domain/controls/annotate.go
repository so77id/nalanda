package controls

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
)

// Annotator is what the controls domain reaches into for the AMC worker's
// annotate half. Declared here per §The dependency rule; the amcworker
// package implements it and the amctest package fakes it.
//
// One method, one copy: the two triggers of issue #190 (auto after
// /analyse for status:ok, manual after every review save) both converge
// here.
type Annotator interface {
	// AnnotateCopy asks the worker for one copy's annotated PDF and
	// returns its path relative to the shared work volume. The overrides
	// are applied by the worker before annotating, so the PDF reflects
	// the professor's corrections, not the original reading.
	AnnotateCopy(ctx context.Context, req AnnotateRequest) (string, error)
}

// AnnotateRequest is what a call needs. Every path is RELATIVE to the
// shared work volume, matching Generator's and Analyzer's conventions.
type AnnotateRequest struct {
	Project   string
	Copy      int
	Overrides AnnotateOverrides
}

// AnnotateOverrides is the professor's corrections, keyed the way the
// worker addresses them. Answers carry the QUESTION NAME —
// layout_question.name, which is the bank ref the server persists as
// Answer.QuestionRef — not the numeric layout id: the server never
// persisted the latter, and the worker resolves the name against the
// layout.
type AnnotateOverrides struct {
	RUT     *string // nil = no RUT correction
	Answers []AnnotateAnswer
}

// AnnotateAnswer is one question's corrected marks. An empty Marked is a
// blank override, not "leave alone".
type AnnotateAnswer struct {
	Question string // the bank ref / layout question name
	Marked   []int
}

// The failure modes callers branch on. Same shape as the generator and
// analyzer pairs, so the two triggers can log-and-continue on either
// without importing the transport.
var (
	// ErrAnnotatorRefused wraps a failure the worker refused — a 4xx, or a
	// response missing its path.
	ErrAnnotatorRefused = errors.New("controls: the AMC worker refused to annotate")

	// ErrAnnotatorUnavailable wraps a transport failure — the worker is not
	// reachable at all.
	ErrAnnotatorUnavailable = errors.New("controls: the AMC worker is unreachable")
)

// Annotate asks the worker for one copy's corrected PDF and persists the
// record. The overrides the worker applies come from the copy's stored
// reading — a copy with no reading has nothing to correct and is refused
// with ErrReadingNotFound.
//
// Guarded by AnnotateEnabled: when the operator switches the flow off
// (NALANDA_ANNOTATE_ENABLED=false, issue #190 §Reversibility), this is a
// no-op and no row is written, so the review page falls back to the raw
// scan everywhere.
//
// A failure does not propagate to the professor's request in either
// trigger: the callers log it and continue, because the correction itself
// is already persisted and the annotate can be retried on the next save.
func (s *Service) Annotate(ctx context.Context, controlID string, copyNumber int) (AnnotatedCopy, error) {
	if !s.AnnotateEnabled {
		s.Log.Debug("controls.Annotate: disabled by configuration",
			"control", controlID, "copy", copyNumber)
		return AnnotatedCopy{}, nil
	}
	control, err := s.Store.ControlByID(ctx, controlID)
	if err != nil {
		return AnnotatedCopy{}, err
	}
	reading, err := s.Readings.ReadingByCopy(ctx, controlID, copyNumber)
	if err != nil {
		return AnnotatedCopy{}, err
	}
	path, err := s.Annotator.AnnotateCopy(ctx, AnnotateRequest{
		Project:   filepath.Join(projectPrefix, control.ID),
		Copy:      copyNumber,
		Overrides: overridesFromReading(reading),
	})
	if err != nil {
		return AnnotatedCopy{}, err
	}
	record := AnnotatedCopy{
		ControlID:   controlID,
		CopyNumber:  copyNumber,
		GeneratedAt: s.Now(),
		Path:        path,
	}
	if err := s.Store.RecordAnnotated(ctx, record); err != nil {
		return AnnotatedCopy{}, fmt.Errorf("controls.Annotate: persist: %w", err)
	}
	return record, nil
}

// overridesFromReading distils the professor's corrections from a
// Reading. Empty when the professor has changed nothing — the worker then
// annotates what AMC read. SaveOverrides clears an override that matches
// the read value, so a non-nil Override here is always a real difference.
func overridesFromReading(r Reading) AnnotateOverrides {
	out := AnnotateOverrides{}
	if r.RUTOverride != nil {
		rut := r.RUTOverride.RUT
		out.RUT = &rut
	}
	for _, a := range r.Answers {
		if a.Override == nil {
			continue
		}
		out.Answers = append(out.Answers, AnnotateAnswer{
			Question: a.QuestionRef,
			// An EMPTY non-nil slice, not nil: nil marshals to JSON null
			// on the wire, and the worker contract spells a blank override
			// as [] (measured against the real worker — null used to
			// answer 400 while the save itself had succeeded).
			Marked: append([]int{}, a.Override.Marked...),
		})
	}
	return out
}
