// Package controls is the entrance-controls domain: a professor picks a range
// of the published question bank, the server draws a pool from it and asks the
// AMC worker to generate copies (docs/design/2026-08-controles.md, WP-E).
//
// This file holds the interfaces the domain consumes and the small value
// types the whole package shares. The Store, the Service and the .tex
// generator live beside it (S3–S5). The dependency rule is the same one that
// governs the auth domain: the interfaces are declared HERE because that is
// where they are consumed, and infra implements them (backend-code-style.md
// §The dependency rule).
package controls

import (
	"context"
	"errors"
)

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

// ErrGeneratorRefused wraps a failure that came from the worker refusing
// the request — a 4xx, or a response naming a missing file. Callers branch
// on it with errors.Is when they want to distinguish an operator-caused
// failure (worker down, wrong URL) from a request-shaped one (a pool that
// somehow produced an empty PDF).
var ErrGeneratorRefused = errors.New("controls: the AMC worker refused the request")

// ErrGeneratorUnavailable wraps a failure that could not reach the worker at
// all — connection refused, DNS, timeout without a response. Same shape as
// the pair above, so a handler can render the two the same way while a
// future operator dashboard can tell them apart.
var ErrGeneratorUnavailable = errors.New("controls: the AMC worker is unreachable")
