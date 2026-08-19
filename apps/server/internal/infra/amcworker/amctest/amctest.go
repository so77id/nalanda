// Package amctest is the test double for controls.Generator.
//
// It lives here rather than beside the domain because a fake is transport
// machinery — the domain does not import it, and putting it in
// internal/domain would drag a channel of stub files into a package the
// dependency rule keeps stdlib-only.
package amctest

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// Fake records every /generate call and, when WorkDir is set, writes the
// stub files a real worker would produce so a caller can round-trip the
// "assets on disk" contract without running AMC.
//
// Field access is protected by mu, so a Service test that spawns goroutines
// can share one Fake without racing.
type Fake struct {
	mu sync.Mutex

	// Calls is the ordered call log. Read by tests after the run to assert
	// what was asked.
	Calls []controls.GenerateRequest

	// WorkDir is the shared-volume root: when set, Generate writes empty
	// sujet.pdf/corrige.pdf/calage.xy files under
	// <WorkDir>/<project>/out/ so a caller reading them back succeeds.
	// An empty WorkDir leaves the disk alone — useful when the test only
	// cares about the recorded call.
	WorkDir string

	// Err, when set, is returned from Generate instead of the success path.
	// Used to drive the failure-mode tests in S6.
	Err error

	// SujetSize sizes the stub sujet.pdf. Zero means "empty file" (which
	// is what the missing-PDF failure mode looks like on disk); a positive
	// value writes that many bytes so the "PDF present" path can also be
	// tested.
	SujetSize int

	// AnalyzeCalls records every Analyze call in order.
	AnalyzeCalls []controls.AnalyzeRequest
	// AnalyzeReports is popped left-to-right, one per Analyze call; the last
	// one sticks (so a test with three uploads and one fixed report gets
	// that report three times). An empty slice returns the zero Report.
	AnalyzeReports []controls.Report
	// AnalyzeErr, when set, is returned from Analyze instead of the success
	// path.
	AnalyzeErr error

	// ReanalyzeCalls records every Reanalyze call in order.
	ReanalyzeCalls []controls.ReanalyzeRequest
	// ReanalyzeReports mirrors AnalyzeReports.
	ReanalyzeReports []controls.Report
	// ReanalyzeErr, when set, is returned from Reanalyze.
	ReanalyzeErr error

	// AnnotateCalls records every AnnotateCopy call in order.
	AnnotateCalls []controls.AnnotateRequest
	// AnnotatedPath overrides the default convention-derived path
	// AnnotateCopy returns.
	AnnotatedPath string
	// AnnotateErr, when set, is returned from AnnotateCopy.
	AnnotateErr error
}

// Generate satisfies controls.Generator. When Err is set, it returns that;
// otherwise it writes the stub files (if WorkDir is set) and returns
// Assets whose Sujet path is relative to WorkDir.
//
// The stub corrige.pdf and calage.xy files are still written to disk even
// though controls.Assets no longer carries their paths — a Service test
// that opens them (or a WP-F test that reads them back) exercises the same
// convention the worker follows, and that convention is where the
// download handlers derive their paths from.
func (f *Fake) Generate(_ context.Context, req controls.GenerateRequest) (controls.Assets, error) {
	f.mu.Lock()
	f.Calls = append(f.Calls, req)
	err := f.Err
	work := f.WorkDir
	size := f.SujetSize
	f.mu.Unlock()

	if err != nil {
		return controls.Assets{}, err
	}

	sujetRel := filepath.Join(req.Project, "out", "sujet.pdf")

	if work != "" {
		outDir := filepath.Join(work, req.Project, "out")
		if err := os.MkdirAll(outDir, 0o755); err != nil {
			return controls.Assets{}, fmt.Errorf("amctest: mkdir %s: %w", outDir, err)
		}
		if err := writeStub(filepath.Join(work, sujetRel), size); err != nil {
			return controls.Assets{}, err
		}
		if err := writeStub(filepath.Join(outDir, "corrige.pdf"), 4); err != nil {
			return controls.Assets{}, err
		}
		if err := writeStub(filepath.Join(outDir, "calage.xy"), 4); err != nil {
			return controls.Assets{}, err
		}
	}

	return controls.Assets{Sujet: sujetRel}, nil
}

func writeStub(path string, size int) error {
	if size < 0 {
		size = 0
	}
	body := make([]byte, size)
	if err := os.WriteFile(path, body, 0o644); err != nil {
		return fmt.Errorf("amctest: write %s: %w", path, err)
	}
	return nil
}

// CallCount returns how many times Generate was called. Handy for tests that
// only care about "was it hit at all".
func (f *Fake) CallCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.Calls)
}

// LastCall returns the last request, if any.
func (f *Fake) LastCall() (controls.GenerateRequest, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.Calls) == 0 {
		return controls.GenerateRequest{}, false
	}
	return f.Calls[len(f.Calls)-1], true
}

// Assert Fake implements controls.Generator at compile time.
var _ controls.Generator = (*Fake)(nil)
