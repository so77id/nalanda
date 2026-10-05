package amctest

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// GenerateSheet is the survey half of the fake (issue #310): it records the
// call and, when WorkDir is set, writes a stub sujet.pdf where the worker
// would. SheetErr, when set, is returned instead.
func (f *Fake) GenerateSheet(_ context.Context, req survey.GenerateRequest) (survey.Assets, error) {
	f.mu.Lock()
	f.SheetCalls = append(f.SheetCalls, req)
	err := f.SheetErr
	work := f.WorkDir
	f.mu.Unlock()

	if err != nil {
		return survey.Assets{}, err
	}
	sujetRel := filepath.Join(req.Project, "out", "sujet.pdf")
	if work != "" {
		outDir := filepath.Join(work, req.Project, "out")
		if err := os.MkdirAll(outDir, 0o755); err != nil {
			return survey.Assets{}, fmt.Errorf("amctest: mkdir %s: %w", outDir, err)
		}
		if err := writeStub(filepath.Join(work, sujetRel), 4); err != nil {
			return survey.Assets{}, err
		}
	}
	return survey.Assets{Sujet: sujetRel}, nil
}

// SheetCallCount is how many sheets were generated.
func (f *Fake) SheetCallCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.SheetCalls)
}

var _ survey.Generator = (*Fake)(nil)

// AnalyzeSheets is the survey reading (issue #311): it records the call
// and returns the next of SurveyReports, or SurveyAnalyzeErr.
func (f *Fake) AnalyzeSheets(_ context.Context, req survey.AnalyzeRequest) (survey.Report, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.SurveyAnalyzeCalls = append(f.SurveyAnalyzeCalls, req)
	if f.SurveyAnalyzeErr != nil {
		return survey.Report{}, f.SurveyAnalyzeErr
	}
	if len(f.SurveyReports) == 0 {
		return survey.Report{Batch: &survey.Batch{}}, nil
	}
	report := f.SurveyReports[0]
	if len(f.SurveyReports) > 1 {
		f.SurveyReports = f.SurveyReports[1:]
	}
	return report, nil
}

var _ survey.Analyzer = (*Fake)(nil)
