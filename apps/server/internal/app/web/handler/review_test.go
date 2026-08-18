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
