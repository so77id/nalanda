package handler_test

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

func readCloser(b []byte) io.ReadCloser {
	return io.NopCloser(bytes.NewReader(b))
}

// The results-table cases verify the estado collapse rules and the
// not_present row (issue #167 §The results table). Each case sets up a
// specific report shape, uploads it, and renders /controls/:id.

func TestResultsTableRendersEveryEstadoCollapse(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control results", 4)

	// A report with four distinct kinds:
	//   copy 1 — ok
	//   copy 2 — RUT unreadable (unreadable + ok answers)
	//   copy 3 — marca dudosa (one doubtful answer)
	//   copy 4 — incomplete (missing page)
	// Copy 5 is not printed here since we asked for 4. MarkMissingAsNotPresent
	// runs for a copy the report never mentioned — but we sent all four,
	// so no not_present row today. We test not_present with a
	// separate case below.
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{
			"1": okCopy("20100001"),
			"2": {RUT: "20?00002", RUTStatus: controls.RUTStatusUnreadable, Status: controls.CopyStatusNeedsReview,
				ExpectedQuestions: 2, SeenQuestions: 2,
				Answers: []controls.ReportAnswer{
					{Question: 1, Name: "q3", Type: controls.QuestionSimple, Marked: []int{1},
						Status: controls.AnswerStatusOK, Score: 1, Max: 1},
					{Question: 2, Name: "q4", Type: controls.QuestionMultiple, Marked: []int{1, 2},
						Status: controls.AnswerStatusOK, Score: 4, Max: 4},
				}},
			"3": {RUT: "20100003", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusNeedsReview,
				ExpectedQuestions: 2, SeenQuestions: 2,
				Answers: []controls.ReportAnswer{
					{Question: 1, Name: "q3", Type: controls.QuestionSimple, Marked: nil,
						Doubtful: []controls.Doubtful{{Answer: 1, Darkness: 0.18}},
						Status:   controls.AnswerStatusDoubtful, Score: 0, Max: 1},
					{Question: 2, Name: "q4", Type: controls.QuestionMultiple, Marked: []int{1},
						Status: controls.AnswerStatusOK, Score: 3, Max: 4},
				}},
			"4": {RUT: "20100004", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusIncomplete,
				ExpectedQuestions: 2, SeenQuestions: 1, MissingQuestions: []string{"q4"},
				Answers: []controls.ReportAnswer{
					{Question: 1, Name: "q3", Type: controls.QuestionSimple, Marked: []int{1},
						Status: controls.AnswerStatusOK, Score: 1, Max: 1},
				}},
		}},
	}

	uploadOnce(t, f, controlID)
	body := getDetail(t, f, controlID)

	for _, want := range []string{
		"ok",
		"⚠ RUT ilegible",
		"⚠ marca dudosa",
		"⚠ página faltante",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("results table does not render %q\n--- body ---\n%s", want, body)
		}
	}
	// The footer summarises the four buckets.
	if !strings.Contains(body, "4 copias impresas") {
		t.Errorf("summary missing from body")
	}
}

func TestResultsTableRendersNotPresentRow(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control not present", 3)

	// Upload a report covering only copy 1 — copies 2 and 3 become
	// not_present via MarkMissingAsNotPresent.
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20111111")}},
	}
	uploadOnce(t, f, controlID)
	body := getDetail(t, f, controlID)

	if !strings.Contains(body, "no rendida") {
		t.Errorf("not_present row not rendered\n--- body ---\n%s", body)
	}
	if !strings.Contains(body, "2 no rendidas") {
		t.Errorf("summary should count 2 no rendidas")
	}
}

func okCopy(rut string) controls.ReportCopy {
	return controls.ReportCopy{
		RUT: rut, RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusOK,
		ExpectedQuestions: 2, SeenQuestions: 2,
		// Pages matches the shape a real 1-page-per-copy control emits —
		// callers overriding for multi-page cases set it explicitly.
		// Without this the raw-scan fallback renders zero <img>, which
		// is honest for the domain but not what the "annotate off" and
		// "stale annotated" tests are checking (they exercise the raw
		// scan render, not an empty section).
		Pages: []int{1},
		Answers: []controls.ReportAnswer{
			{Question: 1, Name: "q3", Type: controls.QuestionSimple, Marked: []int{1},
				Status: controls.AnswerStatusOK, Score: 1, Max: 1},
			{Question: 2, Name: "q4", Type: controls.QuestionMultiple, Marked: []int{1},
				Status: controls.AnswerStatusOK, Score: 4, Max: 4},
		},
	}
}

func uploadOnce(t *testing.T, f *controlsFixture, controlID string) {
	t.Helper()
	body, ct := buildScanUpload(t, "batch.pdf", "application/pdf", []byte("%PDF"))
	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/scans", nil)
	req.Body = readCloser(body.Bytes())
	req.Header.Set("Content-Type", ct)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.UploadScan(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("upload status = %d, want 303", rec.Code)
	}
	// Issue #249: /scans now enqueues an analyse job. Wait for the
	// runner to finish it so callers see the readings the sync path
	// used to leave behind directly.
	f.waitLatestJobTerminal(t, controlID)
}

func getDetail(t *testing.T, f *controlsFixture, controlID string) string {
	t.Helper()
	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID, nil)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.Detail(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail status = %d\nbody: %s", rec.Code, rec.Body.String())
	}
	return rec.Body.String()
}
