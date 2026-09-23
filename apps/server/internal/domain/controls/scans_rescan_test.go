package controls_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
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
// changed nothing, and job.detail keeps the count.
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
	if !strings.Contains(failure.Message, "ninguna página") {
		t.Errorf("banner %q does not say the batch was not read", failure.Message)
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

// runAnalyseJob saves a batch and drives the analyse handler the way the
// runner does, returning what the handler returned.
func runAnalyseJob(t *testing.T, svc *controls.Service, controlID string) error {
	t.Helper()
	save, err := svc.SaveUploadedBatch(context.Background(), controls.UploadRequest{
		ControlID: controlID, Filename: "lote.pdf",
		Content: io.NopCloser(strings.NewReader("%PDF-fake")),
		Ticked:  controls.DefaultTicked, Unsure: controls.DefaultUnsure,
	})
	if err != nil {
		t.Fatalf("SaveUploadedBatch: %v", err)
	}
	raw, _ := json.Marshal(controls.AnalysePayload{BatchName: save.BatchName,
		Ticked: save.Ticked, Unsure: save.Unsure})
	return controls.NewAnalyseHandler(svc)(context.Background(), controlID, raw)
}

// noticeFrom unwraps the *jobs.Notice a handler returns on a success that
// has something to say.
func noticeFrom(t *testing.T, err error) *jobs.Notice {
	t.Helper()
	var notice *jobs.Notice
	if !errors.As(err, &notice) {
		t.Fatalf("the handler returned %v, want a *jobs.Notice", err)
	}
	return notice
}

// Issue #298 §D: a re-read over copies already mailed is not refused —
// ADR-0073 owns that case per copy — but the professor is told, because
// those students hold a grade the new reading may have moved.
func TestAnAnalyseThatReReadPublishedCopiesSaysHowMany(t *testing.T) {
	svc, _, gen, _ := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	svc.Readings.(*fakeReadingStore).publishedAmongReset = 2
	gen.AnalyzeReports = []controls.Report{{
		Batch: &controls.Batch{Captured: 6, RecapturedCopies: []int{1, 2, 3}},
	}}

	notice := noticeFrom(t, runAnalyseJob(t, svc, control.ID))
	if !strings.Contains(notice.Message, "2 copias ya publicadas fueron releídas") {
		t.Errorf("notice %q does not count the published copies re-read", notice.Message)
	}
}

// A batch AMC read in part succeeds — and says how many of its pages it
// did not recognise, since those sheets were not read at all.
func TestAPartlyRecognisedBatchSucceedsAndCountsTheRest(t *testing.T) {
	svc, _, gen, _ := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	gen.AnalyzeReports = []controls.Report{{Batch: &controls.Batch{Captured: 22, Failed: 2}}}

	notice := noticeFrom(t, runAnalyseJob(t, svc, control.ID))
	if !strings.Contains(notice.Message, "2 páginas del lote no se reconocieron") {
		t.Errorf("notice %q does not count the unrecognised pages", notice.Message)
	}
}

// And a batch with nothing to say is a plain success: no notice at all.
func TestACleanBatchHasNoNotice(t *testing.T) {
	svc, _, gen, _ := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	gen.AnalyzeReports = []controls.Report{{Batch: &controls.Batch{Captured: 6, RecapturedCopies: []int{1}}}}

	if err := runAnalyseJob(t, svc, control.ID); err != nil {
		t.Errorf("handler = %v, want nil for a batch with nothing to report", err)
	}
}

// Issue #298 §E: the worker goes first. If it refuses — or predates the
// route — nothing on the server side is destroyed either.
func TestResetScansStopsWhenTheWorkerRefuses(t *testing.T) {
	svc, _, gen, _ := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := uploadBatch(t, svc, control.ID); err != nil {
		t.Fatalf("upload: %v", err)
	}
	gen.ResetErr = &controls.AnalyzerRefusedError{Status: 404, Message: "no route for POST /scans/reset"}

	err = svc.ResetScans(context.Background(), control.ID)
	if !errors.Is(err, controls.ErrAnalyzerRefused) {
		t.Fatalf("ResetScans = %v, want ErrAnalyzerRefused", err)
	}
	for _, c := range svc.Readings.(*fakeReadingStore).calls {
		if strings.HasPrefix(c, "reset-results") {
			t.Errorf("the database was reset (%q) although the worker refused", c)
		}
	}
}

func TestResetScansCallsTheWorkerThenTheDatabase(t *testing.T) {
	svc, _, gen, _ := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := uploadBatch(t, svc, control.ID); err != nil {
		t.Fatalf("upload: %v", err)
	}

	if err := svc.ResetScans(context.Background(), control.ID); err != nil {
		t.Fatalf("ResetScans: %v", err)
	}
	if len(gen.ResetCalls) != 1 || gen.ResetCalls[0] != "controls/"+control.ID {
		t.Errorf("worker reset calls = %v, want one for controls/%s", gen.ResetCalls, control.ID)
	}
	calls := svc.Readings.(*fakeReadingStore).calls
	if len(calls) == 0 || calls[len(calls)-1] != "reset-results "+control.ID {
		t.Errorf("reading store calls = %v, want the reset last", calls)
	}
	uploads, _ := svc.UploadList(control.ID)
	if len(uploads) != 0 {
		t.Errorf("uploads after reset = %v, want none — the next upload is batch-1.pdf", uploads)
	}
}

// Nothing to wipe is its own sentinel, and the worker is not bothered.
func TestResetScansOnAControlWithNoScansIsRefused(t *testing.T) {
	svc, _, gen, _ := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := svc.ResetScans(context.Background(), control.ID); !errors.Is(err, controls.ErrNoScans) {
		t.Fatalf("ResetScans = %v, want ErrNoScans", err)
	}
	if len(gen.ResetCalls) != 0 {
		t.Errorf("the worker was asked to reset %v on a control with no scans", gen.ResetCalls)
	}
}

// #298 review, ARQ-1: an archived control is refused BEFORE the worker
// empties its capture — the SQL guard alone would fire after.
func TestResetScansRefusesAnArchivedControlBeforeTheWorker(t *testing.T) {
	svc, _, gen, _ := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := uploadBatch(t, svc, control.ID); err != nil {
		t.Fatalf("upload: %v", err)
	}
	if err := svc.Archive(context.Background(), control.ID); err != nil {
		t.Fatalf("Archive: %v", err)
	}

	if err := svc.ResetScans(context.Background(), control.ID); !errors.Is(err, controls.ErrControlNotFound) {
		t.Fatalf("ResetScans on an archived control = %v, want ErrControlNotFound", err)
	}
	if len(gen.ResetCalls) != 0 {
		t.Errorf("the worker was asked to reset %v an archived control", gen.ResetCalls)
	}
}
