package handler_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// pdfViewerMarker is the DOM marker the review template writes when the
// annotated-PDF viewer is present (issue #231). Extracted so the positive
// case AND the anti-cases in this file (plus scans_test.go) all read from
// one string — a rename must update ONE symbol, and the anti-cases cannot
// silently drift into vacuous checks the way the pre-#231 `<embed>` anti-
// checks did after the template stopped writing that marker.
const pdfViewerMarker = `id="pdf-viewer"`

func TestReviewPageRendersEditableFormForACopy(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control review", 2)

	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{
			"1": {RUT: "20123456", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusOK,
				ExpectedQuestions: 2, SeenQuestions: 2,
				Answers: []controls.ReportAnswer{
					{Question: 1, Name: "q3", Type: controls.QuestionSimple, Marked: []int{1},
						Status: controls.AnswerStatusOK, Score: 1, Max: 1},
					{Question: 2, Name: "q4", Type: controls.QuestionMultiple, Marked: []int{1, 2},
						Status: controls.AnswerStatusOK, Score: 4, Max: 4},
				}},
		}},
	}
	uploadOnce(t, f, controlID)

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/copies/1/review", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	rec := httptest.NewRecorder()
	f.handler.Review(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d\nbody: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{
		"copia 1",
		"20123456",
		"form",
		`name="csrf_token"`,
		`type="radio"`,    // simple question
		`type="checkbox"`, // multiple question
		"Marcar en blanco",
		// Issue #231: the corrected PDF renders through PDF.js into a
		// container the template owns. The div carries the PDF URL in a
		// data attribute so the inline module script can find it without
		// parsing HTML — a browser's native <embed> viewer had different
		// pagination behaviour per browser (Brave rendered page 1 only,
		// which is what pushed this off the <embed> shipped in #227).
		pdfViewerMarker,
		`data-pdf-url="`,
		"annotated.pdf",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("review page missing %q\n--- body ---\n%s", want, body)
		}
	}
}

// TestReviewPageFallsBackToRawScanWithoutAnnotated pins the fallback of
// issue #190: a copy that was never annotated (needs_review, waiting for
// the professor) shows the raw scan image, not the PDF viewer.
func TestReviewPageFallsBackToRawScanWithoutAnnotated(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control fallback", 1)

	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{
			"1": {RUT: "2011111_", RUTStatus: controls.RUTStatusUnreadable, Status: controls.CopyStatusNeedsReview,
				ExpectedQuestions: 2, SeenQuestions: 2, Pages: []int{1},
				Answers: []controls.ReportAnswer{
					{Question: 1, Name: "q3", Type: controls.QuestionSimple, Marked: []int{1},
						Status: controls.AnswerStatusOK, Score: 1, Max: 1},
					{Question: 2, Name: "q4", Type: controls.QuestionMultiple, Marked: []int{1},
						Status: controls.AnswerStatusOK, Score: 4, Max: 4},
				}},
		}},
	}
	uploadOnce(t, f, controlID)

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/copies/1/review", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	rec := httptest.NewRecorder()
	f.handler.Review(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d\nbody: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, pdfViewerMarker) {
		t.Errorf("review page shows the PDF viewer for a copy with no annotated PDF\n%s", body)
	}
	if !strings.Contains(body, `<img src="/controls/`+controlID+`/copies/1/page/1"`) {
		t.Errorf("review page missing the raw scan image\n%s", body)
	}
}

// TestReviewPageRendersAllCapturedPages pins issue #243's fix:
// a needs_review copy whose scan spans several pages renders one
// <img> per captured page, in ascending order, so the professor can
// see and correct answers on every page instead of only page 1.
func TestReviewPageRendersAllCapturedPages(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control multi-page", 3)

	// Three copies with different page shapes: copy 1 captured both
	// pages (the happy case), copy 2 captured only page 1 (page 2
	// scanned but rejected by AMC — AC-2), copy 3 captured pages 1,
	// 2 and 3 (a longer sheet).
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{
			"1": {RUT: "20111111", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusNeedsReview,
				ExpectedQuestions: 1, SeenQuestions: 1, Pages: []int{1, 2},
				Answers: []controls.ReportAnswer{
					{Question: 1, Name: "q3", Type: controls.QuestionSimple, Marked: []int{1},
						Status: controls.AnswerStatusOK, Score: 1, Max: 1},
				}},
			"2": {RUT: "20222222", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusNeedsReview,
				ExpectedQuestions: 1, SeenQuestions: 1, Pages: []int{1},
				Answers: []controls.ReportAnswer{
					{Question: 1, Name: "q3", Type: controls.QuestionSimple, Marked: []int{1},
						Status: controls.AnswerStatusOK, Score: 1, Max: 1},
				}},
			"3": {RUT: "20333333", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusNeedsReview,
				ExpectedQuestions: 1, SeenQuestions: 1, Pages: []int{1, 2, 3},
				Answers: []controls.ReportAnswer{
					{Question: 1, Name: "q3", Type: controls.QuestionSimple, Marked: []int{1},
						Status: controls.AnswerStatusOK, Score: 1, Max: 1},
				}},
		}},
	}
	uploadOnce(t, f, controlID)

	// Copy 1: both pages rendered, in order.
	body := reviewBody(t, f, controlID, 1)
	for _, want := range []string{
		`<img src="/controls/` + controlID + `/copies/1/page/1"`,
		`<img src="/controls/` + controlID + `/copies/1/page/2"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("copy 1 review missing %q\n--- body ---\n%s", want, body)
		}
	}
	if got := strings.Count(body, `<img src="/controls/`+controlID+`/copies/1/`); got != 2 {
		t.Errorf("copy 1 review = %d raw-scan <img>, want 2 (pages 1 and 2)", got)
	}

	// Copy 2 (AC-2): only page 1 was captured — no phantom page 2.
	body = reviewBody(t, f, controlID, 2)
	if !strings.Contains(body, `<img src="/controls/`+controlID+`/copies/2/page/1"`) {
		t.Errorf("copy 2 review missing page 1\n%s", body)
	}
	if strings.Contains(body, `<img src="/controls/`+controlID+`/copies/2/page/2"`) {
		t.Errorf("copy 2 review shows a phantom page 2 (AMC only captured page 1)\n%s", body)
	}
	if got := strings.Count(body, `<img src="/controls/`+controlID+`/copies/2/`); got != 1 {
		t.Errorf("copy 2 review = %d raw-scan <img>, want 1 (only page 1 captured)", got)
	}

	// Copy 3: all three pages render, in the same order the store returned.
	body = reviewBody(t, f, controlID, 3)
	for n := 1; n <= 3; n++ {
		if !strings.Contains(body, fmt.Sprintf(`<img src="/controls/%s/copies/3/page/%d"`, controlID, n)) {
			t.Errorf("copy 3 review missing page %d\n%s", n, body)
		}
	}
	if got := strings.Count(body, `<img src="/controls/`+controlID+`/copies/3/`); got != 3 {
		t.Errorf("copy 3 review = %d raw-scan <img>, want 3", got)
	}
}

// reviewBody helper: render the review page for one copy and return
// the response body. Keeps TestReviewPageRendersAllCapturedPages
// readable — three copies means three requests.
func reviewBody(t *testing.T, f *controlsFixture, controlID string, copyNumber int) string {
	t.Helper()
	req := f.authedRequest(t, http.MethodGet,
		fmt.Sprintf("/controls/%s/copies/%d/review", controlID, copyNumber), nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", fmt.Sprintf("%d", copyNumber))
	rec := httptest.NewRecorder()
	f.handler.Review(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("copy %d review status = %d\nbody: %s", copyNumber, rec.Code, rec.Body.String())
	}
	return rec.Body.String()
}

// TestAnnotatedPDFServesTheRecordedFile: the row is the authority — the
// endpoint serves the bytes at the recorded path and 404s when no row
// exists.
func TestAnnotatedPDFServesTheRecordedFile(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control pdf", 1)

	rel := "controls/" + controlID + "/annotated/copy-1.pdf"
	if err := os.MkdirAll(filepath.Join(f.workDir, "controls", controlID, "annotated"), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(f.workDir, rel), []byte("%PDF-corrected"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if err := f.cstore.RecordAnnotated(context.Background(), controls.AnnotatedCopy{
		ControlID: controlID, CopyNumber: 1, Path: rel,
	}); err != nil {
		t.Fatalf("RecordAnnotated: %v", err)
	}

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/copies/1/annotated.pdf", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	rec := httptest.NewRecorder()
	f.handler.AnnotatedPDF(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d\nbody: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "%PDF-corrected" {
		t.Errorf("body = %q, want the recorded file's bytes", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/pdf" {
		t.Errorf("Content-Type = %q, want application/pdf", got)
	}
}

func TestAnnotatedPDFIs404WithoutARecord(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control pdf none", 1)

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/copies/1/annotated.pdf", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	rec := httptest.NewRecorder()
	f.handler.AnnotatedPDF(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestReviewPageReturnsErrorForACopyWithoutAReading(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control no reads", 2)

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/copies/1/review", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	rec := httptest.NewRecorder()
	f.handler.Review(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestPageImageServesPngWhenPresent(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control image", 1)

	scansDir := filepath.Join(f.workDir, "controls", controlID, "scans")
	if err := os.MkdirAll(scansDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(scansDir, "copy-1-page-1.png"), fakePNG(), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/copies/1/page/1", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	req.SetPathValue("n", "1")
	rec := httptest.NewRecorder()
	f.handler.PageImage(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d\nbody: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", ct)
	}
	if rec.Body.Len() == 0 {
		t.Error("empty body")
	}
}

// AMC's `getimages --copy-to` writes raster-sourced pages as JPG. The
// naming contract (ADR-0037) is `copy-<N>-page-<M>`; the extension follows
// whatever AMC actually produced. This case pins the JPG branch —
// production 2026-08-19: Miguel's first real scan batch landed as JPG and
// this endpoint returned 404 for every page because it only knew about PNG.
func TestPageImageServesJpgWhenOnlyJpgPresent(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control image jpg", 1)

	scansDir := filepath.Join(f.workDir, "controls", controlID, "scans")
	if err := os.MkdirAll(scansDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(scansDir, "copy-1-page-1.jpg"), fakeJPEG(), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/copies/1/page/1", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	req.SetPathValue("n", "1")
	rec := httptest.NewRecorder()
	f.handler.PageImage(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d\nbody: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Errorf("Content-Type = %q, want image/jpeg", ct)
	}
	if rec.Body.Len() == 0 {
		t.Error("empty body")
	}
}

// PNG wins over JPG when both exist — a control that had a .png staged
// (from a hypothetical vector source) plus a .jpg (from the raster path)
// serves the PNG. Not a case that arises today; pinned so a future engine
// that produces both does not silently flip which one the reviewer sees.
func TestPageImagePrefersPngOverJpg(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control image both", 1)

	scansDir := filepath.Join(f.workDir, "controls", controlID, "scans")
	if err := os.MkdirAll(scansDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(scansDir, "copy-1-page-1.png"), fakePNG(), 0o644); err != nil {
		t.Fatalf("WriteFile .png: %v", err)
	}
	if err := os.WriteFile(filepath.Join(scansDir, "copy-1-page-1.jpg"), fakeJPEG(), 0o644); err != nil {
		t.Fatalf("WriteFile .jpg: %v", err)
	}

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/copies/1/page/1", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	req.SetPathValue("n", "1")
	rec := httptest.NewRecorder()
	f.handler.PageImage(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q, want image/png (PNG wins over JPG)", ct)
	}
}

func TestPageImageReturns404WhenNotOnDisk(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control image missing", 1)

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/copies/1/page/1", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	req.SetPathValue("n", "1")
	rec := httptest.NewRecorder()
	f.handler.PageImage(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// fakeJPEG returns a minimal valid JPEG (1x1 grayscale). Small enough to
// live as a byte literal; enough of a header to satisfy `http.ServeContent`
// and any browser doing MIME sniffing.
func fakeJPEG() []byte {
	return []byte{
		0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
		0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
		0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
		0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
		0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
		0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
		0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
		0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
		0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x14, 0x00, 0x01,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0xFF, 0xC4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,
		0x37, 0xFF, 0xD9,
	}
}

// fakePNG returns the smallest valid PNG (1x1 transparent).
func fakePNG() []byte {
	return []byte{
		0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
		0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
		0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
		0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
		0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
		0x42, 0x60, 0x82,
	}
}

// TestAnnotatedPDFRefusesARecordPointingOutsideTheWorkDir pins the
// containment guard: the row is written from the worker's response, and
// defense-in-depth means a record naming a path outside the shared volume
// is refused rather than served.
func TestAnnotatedPDFRefusesARecordPointingOutsideTheWorkDir(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control escape", 1)

	// A second temp dir, OUTSIDE the fixture's work dir: the file exists
	// on purpose, so the guard must refuse BEFORE the open — not because
	// the file happens to be missing. The relative path between the two is
	// exactly the shape a hostile record would carry.
	outside := t.TempDir()
	secret := filepath.Join(outside, "secrets.pdf")
	if err := os.WriteFile(secret, []byte("secret"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	rel, err := filepath.Rel(f.workDir, secret)
	if err != nil {
		t.Fatalf("Rel: %v", err)
	}
	if err := f.cstore.RecordAnnotated(context.Background(), controls.AnnotatedCopy{
		ControlID: controlID, CopyNumber: 1, Path: filepath.ToSlash(rel),
	}); err != nil {
		t.Fatalf("RecordAnnotated: %v", err)
	}

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/copies/1/annotated.pdf", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	rec := httptest.NewRecorder()
	f.handler.AnnotatedPDF(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for a record outside the work dir", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "secret") {
		t.Errorf("body leaked the outside file")
	}
}

// The flag gates the READ too, not only the write: rows produced while
// the flow was on must not keep rendering the PDF viewer after the operator
// flips it off — the escape hatch exists precisely for the scenario where
// the surviving rows are the stale or broken ones (issue #190 review, F5).
func TestAnnotateDisabledHidesRowsProducedWhileItWasOn(t *testing.T) {
	f := newControlsFixtureWith(t, false)
	controlID := f.createControl(t, "Control off stale", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	if err := f.cstore.RecordAnnotated(context.Background(), controls.AnnotatedCopy{
		ControlID: controlID, CopyNumber: 1,
		Path: "controls/" + controlID + "/annotated/copy-1.pdf",
	}); err != nil {
		t.Fatalf("RecordAnnotated: %v", err)
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
	if strings.Contains(body, pdfViewerMarker) {
		t.Errorf("review page shows the PDF viewer with the flow disabled, stale row or not\n%s", body)
	}
	if !strings.Contains(body, `<img src="/controls/`+controlID+`/copies/1/page/1"`) {
		t.Errorf("review page must serve the raw scan with the flow disabled\n%s", body)
	}

	// The endpoint follows the same gate: a hidden row is a 404, not a
	// PDF the escape hatch was supposed to hide.
	req = f.authedRequest(t, http.MethodGet, "/controls/"+controlID+"/copies/1/annotated.pdf", nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	rec = httptest.NewRecorder()
	f.handler.AnnotatedPDF(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("annotated.pdf status = %d with the flow disabled, want 404", rec.Code)
	}
}
