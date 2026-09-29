package handler_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
)

// Issue #298 §E — "Borrar escaneos y empezar de nuevo", the destructive-
// confirm pair (add-a-backend-endpoint.md): a GET confirmation page and a
// POST that destroys, both refusing a control with nothing to lose.

func resetConfirmRequest(t *testing.T, f *controlsFixture, controlID string) *httptest.ResponseRecorder {
	t.Helper()
	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/scans/reset/confirm", nil)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.ScansResetConfirm(rec, req)
	return rec
}

func resetPost(t *testing.T, f *controlsFixture, controlID, typed string) *httptest.ResponseRecorder {
	t.Helper()
	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/scans/reset",
		url.Values{"confirm_name": {typed}})
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.ScansReset(rec, req)
	return rec
}

// 404, not 403: the destructive form never renders for a control that has
// nothing to lose, and the POST refuses the same way.
func TestTheScanResetIsNotFoundOnAControlWithNoScans(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 298 sin escaneos", 1)

	if rec := resetConfirmRequest(t, f, controlID); rec.Code != http.StatusNotFound {
		t.Errorf("confirm = %d, want 404", rec.Code)
	}
	if rec := resetPost(t, f, controlID, "Control 298 sin escaneos"); rec.Code != http.StatusNotFound {
		t.Errorf("POST = %d, want 404", rec.Code)
	}
	if len(f.fake.ResetCalls) != 0 {
		t.Errorf("the worker was asked to reset %v", f.fake.ResetCalls)
	}
}

// The confirmation page puts in front of the professor what the reset
// takes with it — above all how many students were already mailed.
func TestTheScanResetConfirmationCountsWhatItDestroys(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 298 confirmar", 2)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001"), "2": okCopy("20100002")}},
	}
	uploadOnce(t, f, controlID)
	ctx := context.Background()
	reading, _ := f.service.ReadingFor(ctx, controlID, 1)
	if err := f.cstore.MarkCopyPublished(ctx, reading.ID, reading.ReadAt, "7,0"); err != nil {
		t.Fatalf("MarkCopyPublished: %v", err)
	}

	rec := resetConfirmRequest(t, f, controlID)
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{"2 copias leídas", "1 copia ya publicada", "Control 298 confirmar"} {
		if !strings.Contains(body, want) {
			t.Errorf("the confirmation page does not say %q", want)
		}
	}
}

// A wrong name re-renders with what was typed, and destroys nothing.
func TestAWrongNameRefusesTheScanReset(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 298 nombre", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	rec := resetPost(t, f, controlID, "control 298 nombre")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("POST = %d, want 422", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `value="control 298 nombre"`) {
		t.Error("the typed value is not echoed back")
	}
	if len(f.fake.ResetCalls) != 0 {
		t.Errorf("the worker was asked to reset %v on a wrong name", f.fake.ResetCalls)
	}
	if readings, _ := f.service.ReadingsFor(context.Background(), controlID); len(readings) == 0 {
		t.Error("the readings were dropped on a wrong name")
	}
}

// The right name wipes the scans and returns the control to what
// generation left: no reading, state generated, next upload batch-1.pdf.
func TestTheRightNameResetsTheScans(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 298 reset", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	rec := resetPost(t, f, controlID, "Control 298 reset")
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("POST = %d, want 303\n%s", rec.Code, rec.Body.String())
	}
	if len(f.fake.ResetCalls) != 1 {
		t.Errorf("worker reset calls = %v, want one", f.fake.ResetCalls)
	}
	ctx := context.Background()
	if readings, _ := f.service.ReadingsFor(ctx, controlID); len(readings) != 0 {
		t.Errorf("%d readings survived the reset", len(readings))
	}
	c, err := f.service.Get(ctx, controlID)
	if err != nil || c.State != controls.Generated {
		t.Errorf("control state = %q (err %v), want generated", c.State, err)
	}
	// The banner of the analyse that preceded the reset speaks of scans
	// that no longer exist (#298 review, COR-6).
	if strings.Contains(getDetail(t, f, controlID), "análisis lista") {
		t.Error("the detail page still shows the pre-reset analyse banner")
	}

	// The next upload is batch-1.pdf again.
	uploadOnce(t, f, controlID)
	batch1 := filepath.Join(f.workDir, "controls", controlID, "uploads", "batch-1.pdf")
	if _, err := os.Stat(batch1); err != nil {
		t.Errorf("the upload after a reset is not batch-1.pdf: %v", err)
	}
}

// A worker that refuses — or predates /scans/reset — leaves every reading
// where it was, and the professor is told nothing was deleted.
func TestAWorkerRefusalLeavesTheScansAlone(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 298 worker viejo", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)
	f.fake.ResetErr = &controls.AnalyzerRefusedError{Status: 404, Message: "no route for POST /scans/reset"}

	rec := resetPost(t, f, controlID, "Control 298 worker viejo")
	if rec.Code == http.StatusSeeOther || rec.Code == http.StatusOK {
		t.Fatalf("POST = %d, want an error status", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "no se borró nada") {
		t.Error("the error page does not say nothing was deleted")
	}
	if readings, _ := f.service.ReadingsFor(context.Background(), controlID); len(readings) != 1 {
		t.Errorf("readings after a refused reset = %d, want 1", len(readings))
	}
}

// The detail page offers the reset only when there is something to reset.
func TestTheDetailPageLinksTheResetOnlyWithScans(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 298 enlace", 1)
	link := "/controls/" + controlID + "/scans/reset/confirm"
	if strings.Contains(getDetail(t, f, controlID), link) {
		t.Error("a control with no scans links to the reset")
	}
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)
	if !strings.Contains(getDetail(t, f, controlID), link) {
		t.Error("a control with scans does not link to the reset")
	}
}

// #298 review, COR-2: a reset while THIS control's job runs would race it —
// the analyse writes readings back over the wiped capture. Refused, and
// nothing reaches the worker.
func TestTheScanResetIsRefusedWhileAJobRuns(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 298 en curso", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)
	ctx := context.Background()
	id, err := f.jstore.Insert(ctx, jobs.NewJob{ControlID: controlID, Kind: jobs.KindReanalyse, Payload: []byte(`{}`)}, time.Now())
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if err := f.jstore.MarkRunning(ctx, id, time.Now()); err != nil {
		t.Fatalf("MarkRunning: %v", err)
	}

	rec := resetPost(t, f, controlID, "Control 298 en curso")
	if rec.Code != http.StatusConflict {
		t.Fatalf("POST = %d, want 409", rec.Code)
	}
	if len(f.fake.ResetCalls) != 0 {
		t.Errorf("the worker was asked to reset %v while a job ran", f.fake.ResetCalls)
	}
	if readings, _ := f.service.ReadingsFor(ctx, controlID); len(readings) != 1 {
		t.Errorf("readings after a refused reset = %d, want 1", len(readings))
	}
}

// #298 review, COR-1: a worker busy with ANOTHER control refuses at once;
// the professor is told nothing was deleted.
func TestABusyWorkerRefusesTheScanReset(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 298 motor ocupado", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)
	f.fake.ResetErr = controls.ErrAnalyzerBusy

	rec := resetPost(t, f, controlID, "Control 298 motor ocupado")
	if rec.Code != http.StatusConflict {
		t.Fatalf("POST = %d, want 409", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "no se borró nada") {
		t.Error("the page does not say nothing was deleted")
	}
}
