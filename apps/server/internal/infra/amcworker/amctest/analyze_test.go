package amctest_test

import (
	"context"
	"errors"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker/amctest"
)

func TestFakeAnalyzeRecordsCallsAndReturnsFixture(t *testing.T) {
	report := controls.Report{
		Pages:  controls.Pages{Captured: 4, Failed: 0},
		Copies: map[string]controls.ReportCopy{"1": {RUT: "20123456", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusOK}},
	}
	f := &amctest.Fake{AnalyzeReports: []controls.Report{report}}

	got, err := f.Analyze(context.Background(), controls.AnalyzeRequest{
		Project: "controls/abc", ScanPDF: "controls/abc/scans/1.pdf", Source: "controls/abc/inputs/source.tex",
	})
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	if got.Copies["1"].RUT != "20123456" {
		t.Errorf("returned report = %+v", got)
	}
	if f.AnalyzeCallCount() != 1 {
		t.Errorf("AnalyzeCallCount = %d, want 1", f.AnalyzeCallCount())
	}
	last, ok := f.LastAnalyzeCall()
	if !ok || last.Project != "controls/abc" {
		t.Errorf("LastAnalyzeCall = %+v, ok=%v", last, ok)
	}

	// A second call with only one report queued still gets that report — it
	// sticks so a two-upload test does not have to pre-load two fixtures
	// when it only wants to observe the second call.
	if _, err := f.Analyze(context.Background(), controls.AnalyzeRequest{
		Project: "controls/abc", ScanPDF: "controls/abc/scans/2.pdf", Source: "controls/abc/inputs/source.tex",
	}); err != nil {
		t.Fatalf("Analyze (2): %v", err)
	}
	if f.AnalyzeCallCount() != 2 {
		t.Errorf("AnalyzeCallCount after two = %d, want 2", f.AnalyzeCallCount())
	}
}

func TestFakeAnalyzeReturnsErr(t *testing.T) {
	boom := errors.New("boom")
	f := &amctest.Fake{AnalyzeErr: boom}
	if _, err := f.Analyze(context.Background(), controls.AnalyzeRequest{Project: "p"}); !errors.Is(err, boom) {
		t.Errorf("Analyze: %v, want boom", err)
	}
}

func TestFakeReanalyzeRecordsCallsAndReturnsFixture(t *testing.T) {
	report := controls.Report{Scoring: controls.Scoring{Seuil: 0.30, Ticked: 0.25, Stale: true}}
	f := &amctest.Fake{ReanalyzeReports: []controls.Report{report}}

	got, err := f.Reanalyze(context.Background(), controls.ReanalyzeRequest{
		Project: "controls/abc", Ticked: 0.25, Unsure: 0.1,
	})
	if err != nil {
		t.Fatalf("Reanalyze: %v", err)
	}
	if !got.Scoring.Stale || got.Scoring.Ticked != 0.25 {
		t.Errorf("returned report = %+v", got)
	}
	last, ok := f.LastReanalyzeCall()
	if !ok || last.Ticked != 0.25 || last.Unsure != 0.1 {
		t.Errorf("LastReanalyzeCall = %+v, ok=%v", last, ok)
	}
}
