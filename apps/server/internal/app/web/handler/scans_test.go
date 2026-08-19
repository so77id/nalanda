package handler_test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// createControl runs the domain Service to make a real control with N
// copies and returns its id. Handler tests hang off this so a scan test
// starts from a valid on-disk project rather than a hand-built fixture.
func (f *controlsFixture) createControl(t *testing.T, name string, copies int) string {
	t.Helper()
	ctx := context.Background()
	c, err := f.service.Create(ctx, controls.CreateRequest{
		Name:             name,
		RangeFrom:        bank.SectionRef{Document: "flujo", Section: "if-else"},
		RangeTo:          bank.SectionRef{Document: "flujo", Section: "bucles"},
		QuestionsPerCopy: 2,
		Copies:           copies,
		CreatedBy:        f.user.ID,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	return c.ID
}

// buildScanUpload writes a multipart body with a single PDF part.
func buildScanUpload(t *testing.T, filename, contentType string, body []byte) (*bytes.Buffer, string) {
	t.Helper()
	return buildScanUploadWithFields(t, filename, contentType, body, nil)
}

// buildScanUploadWithFields is buildScanUpload plus extra form fields —
// the threshold pair since issue #197.
func buildScanUploadWithFields(t *testing.T, filename, contentType string, body []byte, fields map[string]string) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	partHeader := make(map[string][]string)
	partHeader["Content-Disposition"] = []string{
		fmt.Sprintf(`form-data; name="scan"; filename="%s"`, filename),
	}
	if contentType != "" {
		partHeader["Content-Type"] = []string{contentType}
	}
	part, err := w.CreatePart(partHeader)
	if err != nil {
		t.Fatalf("CreatePart: %v", err)
	}
	if _, err := part.Write(body); err != nil {
		t.Fatalf("write body: %v", err)
	}
	for name, value := range fields {
		if err := w.WriteField(name, value); err != nil {
			t.Fatalf("WriteField %s: %v", name, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return &buf, w.FormDataContentType()
}

func TestUploadScanCallsAnalyzerAndFlashesSuccess(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 1", 3)

	// Pre-load a report so the fake returns it.
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{
			"1": {RUT: "20123456", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusOK,
				ExpectedQuestions: 2, SeenQuestions: 2,
				Answers: []controls.ReportAnswer{
					{Question: 1, Name: "q3", Type: controls.QuestionSimple,
						Marked: []int{1}, Status: controls.AnswerStatusOK, Score: 1, Max: 1},
					{Question: 2, Name: "q4", Type: controls.QuestionMultiple,
						Marked: []int{1}, Status: controls.AnswerStatusOK, Score: 4, Max: 4},
				}},
		}},
	}

	body, ct := buildScanUpload(t, "batch.pdf", "application/pdf", []byte("%PDF-fake"))
	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/scans", nil)
	req.Body = io.NopCloser(body)
	req.Header.Set("Content-Type", ct)
	req.ContentLength = int64(body.Len())
	req.SetPathValue("id", controlID)

	rec := httptest.NewRecorder()
	f.handler.UploadScan(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", rec.Code)
	}
	if got := rec.Header().Get("Location"); got != "/controls/"+controlID {
		t.Errorf("Location = %q", got)
	}
	if count := f.fake.AnalyzeCallCount(); count != 1 {
		t.Errorf("AnalyzeCallCount = %d, want 1", count)
	}
	last, _ := f.fake.LastAnalyzeCall()
	if !strings.HasPrefix(last.Project, "controls/") {
		t.Errorf("Analyze project = %q, want prefix controls/", last.Project)
	}
	// The uploaded PDF landed on disk.
	uploads := filepath.Join(f.workDir, "controls", controlID, "uploads")
	entries, _ := os.ReadDir(uploads)
	if len(entries) != 1 || entries[0].Name() != "batch-1.pdf" {
		t.Errorf("uploads dir = %v", entries)
	}

	// Issue #190, ruta A: the one clean copy got its annotated PDF without
	// any human touching the queue.
	if count := f.fake.AnnotateCallCount(); count != 1 {
		t.Errorf("AnnotateCallCount = %d, want 1 (one ok copy)", count)
	}
}

// TestUploadScanAnnotatesEveryCleanCopy pins ruta A: the trigger fires once
// per status:ok copy — and only for those. A copy in needs_review waits for
// the professor (ruta B).
func TestUploadScanAnnotatesEveryCleanCopy(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 3", 3)

	answer := func(q int, name string, typ controls.QuestionType, marked []int) controls.ReportAnswer {
		return controls.ReportAnswer{Question: q, Name: name, Type: typ,
			Marked: marked, Status: controls.AnswerStatusOK, Score: 1, Max: 1}
	}
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{
			"1": {RUT: "20123456", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusOK,
				ExpectedQuestions: 2, SeenQuestions: 2,
				Answers: []controls.ReportAnswer{
					answer(1, "q3", controls.QuestionSimple, []int{1}),
					answer(2, "q4", controls.QuestionSimple, []int{2}),
				}},
			"2": {RUT: "19876543", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusOK,
				ExpectedQuestions: 2, SeenQuestions: 2,
				Answers: []controls.ReportAnswer{
					answer(1, "q3", controls.QuestionSimple, []int{2}),
					answer(2, "q4", controls.QuestionSimple, []int{1}),
				}},
			"3": {RUT: "1912345_", RUTStatus: controls.RUTStatusUnreadable, Status: controls.CopyStatusNeedsReview,
				ExpectedQuestions: 2, SeenQuestions: 2,
				Answers: []controls.ReportAnswer{
					answer(1, "q3", controls.QuestionSimple, []int{1}),
					answer(2, "q4", controls.QuestionSimple, []int{2}),
				}},
		}},
	}

	body, ct := buildScanUpload(t, "batch.pdf", "application/pdf", []byte("%PDF-fake"))
	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/scans", nil)
	req.Body = io.NopCloser(body)
	req.Header.Set("Content-Type", ct)
	req.ContentLength = int64(body.Len())
	req.SetPathValue("id", controlID)

	rec := httptest.NewRecorder()
	f.handler.UploadScan(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", rec.Code)
	}

	if count := f.fake.AnnotateCallCount(); count != 2 {
		t.Fatalf("AnnotateCallCount = %d, want 2 (copies 1 and 2 are ok)", count)
	}
	// Indexed by copy: LastAnnotateCall inspects the last call, so a
	// per-copy assertion built on it would actually be asserting copy 2
	// for both copies (issue #190 review, F7).
	byCopy := map[int]controls.AnnotateRequest{}
	for _, call := range f.fake.AnnotateCalls {
		byCopy[call.Copy] = call
	}
	for _, copy := range []int{1, 2} {
		call, ok := byCopy[copy]
		if !ok {
			t.Errorf("no annotate call for copy %d", copy)
			continue
		}
		if call.Overrides.RUT != nil {
			t.Errorf("copy %d sent a RUT override it does not have", copy)
		}
	}
	if _, seen := byCopy[3]; seen {
		t.Error("copy 3 is needs_review and must not be annotated automatically")
	}

	ctx := context.Background()
	for _, copy := range []int{1, 2} {
		_, exists, err := f.cstore.AnnotatedByCopy(ctx, controlID, copy)
		if err != nil || !exists {
			t.Errorf("annotated_copy row for copy %d: exists=%v err=%v", copy, exists, err)
		}
	}
	if _, exists, err := f.cstore.AnnotatedByCopy(ctx, controlID, 3); err != nil || exists {
		t.Errorf("annotated_copy row for copy 3: exists=%v err=%v, want none", exists, err)
	}
}

func TestUploadScanRejectsNonPDF(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 2", 2)

	body, ct := buildScanUpload(t, "notes.txt", "text/plain", []byte("hello"))
	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/scans", nil)
	req.Body = io.NopCloser(body)
	req.Header.Set("Content-Type", ct)
	req.ContentLength = int64(body.Len())
	req.SetPathValue("id", controlID)

	rec := httptest.NewRecorder()
	f.handler.UploadScan(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303 (flash + redirect back)", rec.Code)
	}
	if f.fake.AnalyzeCallCount() != 0 {
		t.Errorf("Analyze called for non-PDF: %d", f.fake.AnalyzeCallCount())
	}
}

// TestUploadScanUnknownControlIs404 keeps the URL boundary honest.
func TestUploadScanUnknownControlIs404(t *testing.T) {
	f := newControlsFixture(t)
	body, ct := buildScanUpload(t, "batch.pdf", "application/pdf", []byte("%PDF"))

	req := f.authedRequest(t, http.MethodPost, "/controls/CTRLBADIDBADIDBADIDBADIDID/scans", nil)
	req.Body = io.NopCloser(body)
	req.Header.Set("Content-Type", ct)
	req.SetPathValue("id", "CTRLBADIDBADIDBADIDBADIDID")

	rec := httptest.NewRecorder()
	f.handler.UploadScan(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// TestCloseCorrectionFiresTheHookAfterGrading pins AC-8's ordering half:
// the hook runs AFTER the state committed as Graded — the recording hook
// captures the state it saw, so an inverted order fails the assertion
// rather than merely reordering two log lines.
func TestCloseCorrectionFiresTheHookAfterGrading(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control close", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/close", nil)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.CloseCorrection(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", rec.Code)
	}
	if got := rec.Header().Get("Location"); got != "/controls/"+controlID {
		t.Errorf("Location = %q", got)
	}

	if len(f.hook.calls) != 2 {
		t.Fatalf("hook calls = %v, want [controlID, state-as-seen]", f.hook.calls)
	}
	if f.hook.calls[0] != controlID {
		t.Errorf("hook control id = %q, want %q", f.hook.calls[0], controlID)
	}
	if f.hook.calls[1] != string(controls.Graded) {
		t.Errorf("hook saw state %q, want %q — the hook must run after the state commits",
			f.hook.calls[1], controls.Graded)
	}

	got, err := f.service.Get(context.Background(), controlID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.State != controls.Graded {
		t.Errorf("control state = %q, want graded", got.State)
	}
}

// TestAnnotateDisabledServesRawEverywhere is the AC-7 integration case on
// the OFF side: the flag removed the whole loop — no worker calls, no
// annotated_copy rows, the review page serves the raw scan. The ON side
// is every other test in this package (S5/S6/S7 all run with the default
// true fixture).
func TestAnnotateDisabledServesRawEverywhere(t *testing.T) {
	f := newControlsFixtureWith(t, false)
	controlID := f.createControl(t, "Control off", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	if count := f.fake.AnnotateCallCount(); count != 0 {
		t.Errorf("AnnotateCallCount = %d with the flow disabled, want 0", count)
	}
	if _, exists, err := f.cstore.AnnotatedByCopy(context.Background(), controlID, 1); err != nil || exists {
		t.Errorf("annotated_copy row exists=%v err=%v, want none", exists, err)
	}

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/copies/1/review", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	rec := httptest.NewRecorder()
	f.handler.Review(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "<iframe") {
		t.Errorf("review page shows an iframe with the flow disabled\n%s", body)
	}
	if !strings.Contains(body, `<img src="/controls/`+controlID+`/copies/1/page/1"`) {
		t.Errorf("review page must serve the raw scan with the flow disabled\n%s", body)
	}
}

// Issue #197: the optional threshold fields travel with the upload — the
// analyzer is asked to read at them, the control stores them, and the
// annotate calls carry the stored ticked so the PDFs agree.
func TestUploadScanWithExplicitThresholds(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control umbral", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}

	body, ct := buildScanUploadWithFields(t, "batch.pdf", "application/pdf",
		[]byte("%PDF-fake"), map[string]string{"ticked": "0.25", "unsure": "0.10"})
	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/scans", nil)
	req.Body = io.NopCloser(body)
	req.Header.Set("Content-Type", ct)
	req.ContentLength = int64(body.Len())
	req.SetPathValue("id", controlID)

	rec := httptest.NewRecorder()
	f.handler.UploadScan(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d\nbody: %s", rec.Code, rec.Body.String())
	}

	last, _ := f.fake.LastAnalyzeCall()
	if last.Ticked != 0.25 || last.Unsure != 0.10 {
		t.Errorf("Analyze called with (%v, %v), want (0.25, 0.10)", last.Ticked, last.Unsure)
	}
	got, err := f.service.Get(context.Background(), controlID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Ticked != 0.25 || got.Unsure != 0.10 {
		t.Errorf("control stored (%v, %v), want (0.25, 0.10)", got.Ticked, got.Unsure)
	}
	annotate, ok := f.fake.LastAnnotateCall()
	if !ok {
		t.Fatal("no annotate call")
	}
	if annotate.Ticked != 0.25 {
		t.Errorf("annotate called with ticked %v, want the stored 0.25", annotate.Ticked)
	}
}

// The re-read persists the pair it used and re-annotates the copies the
// new reading accepts (ruta A over the new report).
func TestReanalyzePersistsThresholdsAndReannotates(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control re", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)
	before := f.fake.AnnotateCallCount()

	f.fake.ReanalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	values := url.Values{"ticked": {"0.20"}, "unsure": {"0.05"}}
	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/reanalyze", values)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.ReanalyzeScans(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d\nbody: %s", rec.Code, rec.Body.String())
	}
	got, err := f.service.Get(context.Background(), controlID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Ticked != 0.20 || got.Unsure != 0.05 {
		t.Errorf("control stored (%v, %v), want (0.20, 0.05)", got.Ticked, got.Unsure)
	}
	if after := f.fake.AnnotateCallCount(); after != before+1 {
		t.Errorf("AnnotateCallCount = %d after reanalyze, want %d (one re-annotated ok copy)",
			after, before+1)
	}
	if _, exists, err := f.cstore.AnnotatedByCopy(context.Background(), controlID, 1); err != nil || !exists {
		t.Errorf("annotated row after reanalyze: exists=%v err=%v, want the re-annotation", exists, err)
	}
	annotate, _ := f.fake.LastAnnotateCall()
	if annotate.Ticked != 0.20 {
		t.Errorf("re-annotate called with ticked %v, want the stored 0.20", annotate.Ticked)
	}
}

// The band rule is enforced at the form boundary: an inverted pair never
// reaches the worker.
func TestReanalyzeRefusesAnInvertedBand(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control banda", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	values := url.Values{"ticked": {"0.05"}, "unsure": {"0.20"}}
	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/reanalyze", values)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.ReanalyzeScans(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d", rec.Code)
	}
	if count := len(f.fake.ReanalyzeCalls); count != 0 {
		t.Errorf("Reanalyze called %d times with an inverted band, want 0", count)
	}
}

// Issue #204: the uploaded batch is downloadable from the control page —
// the endpoint streams the stored batch-N.pdf with download headers.
func TestUploadsPDFServesTheStoredBatch(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control batch", 1)

	uploads := filepath.Join(f.workDir, "controls", controlID, "uploads")
	if err := os.MkdirAll(uploads, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(uploads, "batch-1.pdf"), []byte("%PDF-batch"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/uploads/batch-1.pdf", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("batch", "batch-1.pdf")
	rec := httptest.NewRecorder()
	f.handler.UploadsPDF(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d\nbody: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "%PDF-batch" {
		t.Errorf("body = %q, want the stored batch bytes", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/pdf" {
		t.Errorf("Content-Type = %q, want application/pdf", got)
	}
	if got := rec.Header().Get("Content-Disposition"); !strings.Contains(got, "attachment") ||
		!strings.Contains(got, "batch-1.pdf") {
		t.Errorf("Content-Disposition = %q, want an attachment named batch-1.pdf", got)
	}
}

// The batch name is a URL segment validated against the domain's batch
// contract (IsBatchName): names outside it 404 before any file is opened
// — including batch-0.pdf, which nextBatchNumber can never produce — as
// do an unknown control and a batch that is not on disk.
func TestUploadsPDFRefusesBadNamesMissingFilesAndUnknownControls(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control batch 404", 1)

	cases := []struct {
		name  string
		id    string
		batch string
	}{
		{"unknown control", "CTRLBADIDBADIDBADIDBADIDID", "batch-1.pdf"},
		{"traversal-ish segment", controlID, ".."},
		{"non-contract name", controlID, "notas.txt"},
		{"zero batch", controlID, "batch-0.pdf"},
		{"missing on disk", controlID, "batch-7.pdf"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := f.authedRequest(t, http.MethodGet, "/controls/"+c.id+"/uploads/"+c.batch, nil)
			req.SetPathValue("id", c.id)
			req.SetPathValue("batch", c.batch)
			rec := httptest.NewRecorder()
			f.handler.UploadsPDF(rec, req)
			if rec.Code != http.StatusNotFound {
				t.Errorf("status = %d, want 404", rec.Code)
			}
		})
	}
}

// Issue #204: the detail page lists the uploaded batches with download
// links — and renders nothing when no batch exists yet.
func TestDetailListsUploadedBatchesWithDownloadLinks(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control lista lotes", 1)

	uploads := filepath.Join(f.workDir, "controls", controlID, "uploads")
	if err := os.MkdirAll(uploads, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	for _, name := range []string{"batch-1.pdf", "batch-2.pdf"} {
		if err := os.WriteFile(filepath.Join(uploads, name), []byte("%PDF"), 0o644); err != nil {
			t.Fatalf("WriteFile %s: %v", name, err)
		}
	}

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID, nil)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.Detail(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{
		"Lotes subidos",
		`href="/controls/` + controlID + `/uploads/batch-1.pdf"`,
		`href="/controls/` + controlID + `/uploads/batch-2.pdf"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("detail page missing %q\n--- body ---\n%s", want, body)
		}
	}
}

func TestDetailShowsNoUploadSectionWhenNothingWasUploaded(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control sin lotes", 1)

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID, nil)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.Detail(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "Lotes subidos") {
		t.Error("detail page shows the upload section with no batches on disk")
	}
}
