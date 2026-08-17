package amctest

import (
	"context"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// Analyze satisfies controls.Analyzer. Records the call and returns whatever
// Report is at the head of AnalyzeReports (or an empty Report if the slice
// is empty). AnalyzeErr wins over both.
func (f *Fake) Analyze(_ context.Context, req controls.AnalyzeRequest) (controls.Report, error) {
	f.mu.Lock()
	f.AnalyzeCalls = append(f.AnalyzeCalls, req)
	err := f.AnalyzeErr
	var report controls.Report
	if len(f.AnalyzeReports) > 0 {
		report = f.AnalyzeReports[0]
		if len(f.AnalyzeReports) > 1 {
			f.AnalyzeReports = f.AnalyzeReports[1:]
		}
	}
	f.mu.Unlock()

	if err != nil {
		return controls.Report{}, err
	}
	return report, nil
}

// Reanalyze satisfies controls.Analyzer. Same shape as Analyze: records the
// call, pops from ReanalyzeReports, honours ReanalyzeErr.
func (f *Fake) Reanalyze(_ context.Context, req controls.ReanalyzeRequest) (controls.Report, error) {
	f.mu.Lock()
	f.ReanalyzeCalls = append(f.ReanalyzeCalls, req)
	err := f.ReanalyzeErr
	var report controls.Report
	if len(f.ReanalyzeReports) > 0 {
		report = f.ReanalyzeReports[0]
		if len(f.ReanalyzeReports) > 1 {
			f.ReanalyzeReports = f.ReanalyzeReports[1:]
		}
	}
	f.mu.Unlock()

	if err != nil {
		return controls.Report{}, err
	}
	return report, nil
}

// AnalyzeCallCount returns how many times Analyze was called.
func (f *Fake) AnalyzeCallCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.AnalyzeCalls)
}

// LastAnalyzeCall returns the last Analyze request, if any.
func (f *Fake) LastAnalyzeCall() (controls.AnalyzeRequest, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.AnalyzeCalls) == 0 {
		return controls.AnalyzeRequest{}, false
	}
	return f.AnalyzeCalls[len(f.AnalyzeCalls)-1], true
}

// LastReanalyzeCall returns the last Reanalyze request, if any.
func (f *Fake) LastReanalyzeCall() (controls.ReanalyzeRequest, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.ReanalyzeCalls) == 0 {
		return controls.ReanalyzeRequest{}, false
	}
	return f.ReanalyzeCalls[len(f.ReanalyzeCalls)-1], true
}
