package handler_test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
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
