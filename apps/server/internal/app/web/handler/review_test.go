package handler_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

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
	} {
		if !strings.Contains(body, want) {
			t.Errorf("review page missing %q\n--- body ---\n%s", want, body)
		}
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
