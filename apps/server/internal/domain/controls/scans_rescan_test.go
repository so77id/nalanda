package controls_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// Issue #298: re-scanning a control. The worker captures in single mode, so
// a second batch REPLACES the pages it re-scans; these cases pin what the
// server does with what the worker says a batch did.

// uploadBatch saves one batch through the sync half and runs the async
// half, returning the async half's error.
func uploadBatch(t *testing.T, svc *controls.Service, controlID string) error {
	t.Helper()
	save, err := svc.SaveUploadedBatch(context.Background(), controls.UploadRequest{
		ControlID: controlID,
		Filename:  "lote.pdf",
		Content:   io.NopCloser(strings.NewReader("%PDF-fake")),
		Ticked:    controls.DefaultTicked,
		Unsure:    controls.DefaultUnsure,
	})
	if err != nil {
		t.Fatalf("SaveUploadedBatch: %v", err)
	}
	_, err = svc.AnalyzeBatch(context.Background(), controlID, save.BatchName, save.Ticked, save.Unsure)
	return err
}

// In single mode AMC registers a page it does not recognise in
// capture_failed and EXITS 0 — the loud abort lived inside the photocopy
// block the worker no longer runs. A batch from another control would
// then end green having changed nothing. The server is where that
// loudness moves.
func TestABatchThatCapturedNothingFailsAndWritesNothing(t *testing.T) {
	svc, _, gen, _ := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	gen.AnalyzeReports = []controls.Report{{
		Pages: controls.Pages{Captured: 24, Failed: 12},
		Batch: &controls.Batch{Captured: 0, Failed: 12},
	}}

	err = uploadBatch(t, svc, control.ID)
	if !errors.Is(err, controls.ErrNothingCaptured) {
		t.Fatalf("AnalyzeBatch = %v, want ErrNothingCaptured", err)
	}
	if !strings.Contains(err.Error(), "12") {
		t.Errorf("error %q does not name the unrecognised count", err)
	}
	if n := svc.Readings.(*fakeReadingStore).upserts; n != 0 {
		t.Errorf("readings were upserted %d times, want 0 — nothing was read", n)
	}
}

// The banner is the only thing the professor reads: it says the batch
// changed nothing and the likeliest cause, and job.detail keeps the count.
func TestTheAnalyseJobNamesTheUnrecognisedPages(t *testing.T) {
	svc, _, gen, _ := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	save, err := svc.SaveUploadedBatch(context.Background(), controls.UploadRequest{
		ControlID: control.ID, Filename: "lote.pdf",
		Content: io.NopCloser(strings.NewReader("%PDF-fake")),
		Ticked:  controls.DefaultTicked, Unsure: controls.DefaultUnsure,
	})
	if err != nil {
		t.Fatalf("SaveUploadedBatch: %v", err)
	}
	gen.AnalyzeReports = []controls.Report{{Batch: &controls.Batch{Captured: 0, Failed: 12}}}

	raw, _ := json.Marshal(controls.AnalysePayload{BatchName: save.BatchName,
		Ticked: save.Ticked, Unsure: save.Unsure})
	failure := failureFrom(t, controls.NewAnalyseHandler(svc)(context.Background(), control.ID, raw))
	if !strings.Contains(failure.Message, "otro control") {
		t.Errorf("banner %q does not name the likeliest cause", failure.Message)
	}
	if !strings.Contains(failure.Detail, "12") {
		t.Errorf("detail %q does not carry the unrecognised count", failure.Detail)
	}
}

// A report with no batch — the fakes, and anything that predates the
// field without going through the client's substitution — is not a batch
// that read nothing. Gating on it would fail every legacy read.
func TestAReportWithoutABatchIsNotRefused(t *testing.T) {
	svc, _, gen, _ := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	gen.AnalyzeReports = []controls.Report{{Pages: controls.Pages{Captured: 10}}}

	if err := uploadBatch(t, svc, control.ID); err != nil {
		t.Fatalf("AnalyzeBatch = %v, want success", err)
	}
}

// Issue #298 §C: the copies a batch re-captured are reset BEFORE the report
// is persisted — the order matters, because the upsert is what the
// corrections would otherwise be re-applied on top of.
func TestARecapturedCopyIsResetBeforeTheReportLands(t *testing.T) {
	svc, _, gen, _ := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	gen.AnalyzeReports = []controls.Report{{
		Batch: &controls.Batch{Captured: 4, RecapturedCopies: []int{2, 3}},
	}}

	if err := uploadBatch(t, svc, control.ID); err != nil {
		t.Fatalf("AnalyzeBatch: %v", err)
	}
	fake := svc.Readings.(*fakeReadingStore)
	if got := fake.calls; len(got) < 2 || got[0] != "reset [2 3]" || got[1] != "upsert" {
		t.Errorf("reading store calls = %v, want reset [2 3] then upsert", got)
	}
}

// A batch that re-captured nothing resets nothing: every copy's
// corrections are still valid against the image they were made on.
func TestABatchThatRecapturedNothingResetsNothing(t *testing.T) {
	svc, _, gen, _ := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	gen.AnalyzeReports = []controls.Report{{Batch: &controls.Batch{Captured: 4}}}

	if err := uploadBatch(t, svc, control.ID); err != nil {
		t.Fatalf("AnalyzeBatch: %v", err)
	}
	for _, c := range svc.Readings.(*fakeReadingStore).calls {
		if strings.HasPrefix(c, "reset") {
			t.Errorf("reading store call %q on a batch that re-captured nothing", c)
		}
	}
}
