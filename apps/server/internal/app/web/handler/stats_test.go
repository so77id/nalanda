package handler_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// The statistics panel is gated on Control.State == Graded (issue
// #251, AC-1/AC-2). Before that the page hides the panel entirely;
// once the professor closes the correction, the panel renders on the
// next detail request without a re-upload or worker call.

func TestDetailNoStatsPanelWhenNotGraded(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control sin cerrar", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)
	body := getDetail(t, f, controlID)
	if strings.Contains(body, `id="estadisticas"`) {
		t.Errorf("stats panel rendered before close correction\n--- body ---\n%s", body)
	}
}

func TestDetailStatsPanelRendersHistogramBoxplotAndItemTable(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control detallado", 3)
	// Three copies: two graded perfectly (7.0), one graded partially
	// (grade 4.0 = 1/2 → 50%). Enough to make N > 1 so histogram bars
	// have height, and the item analysis table has both correct and
	// wrong contributions.
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{
			"1": okCopy("20100001"),
			"2": okCopy("20100002"),
			"3": {RUT: "20100003", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusOK,
				ExpectedQuestions: 2, SeenQuestions: 2, Pages: []int{1},
				Answers: []controls.ReportAnswer{
					{Question: 1, Name: "q3", Type: controls.QuestionSimple, Marked: []int{2},
						Status: controls.AnswerStatusOK, Score: 0, Max: 1},
					{Question: 2, Name: "q4", Type: controls.QuestionMultiple, Marked: []int{1},
						Status: controls.AnswerStatusOK, Score: 4, Max: 4},
				}},
		}},
	}
	uploadOnce(t, f, controlID)

	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/close", nil)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.CloseCorrection(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("close status = %d, want 303", rec.Code)
	}

	body := getDetail(t, f, controlID)
	// The histogram is inline SVG — its container carries a stable id
	// so the panel can be located from the DOM.
	if !strings.Contains(body, `class="estadisticas-histograma"`) {
		t.Errorf("histogram not rendered")
	}
	// The boxplot renders alongside.
	if !strings.Contains(body, `class="estadisticas-boxplot"`) {
		t.Errorf("boxplot not rendered")
	}
	// The item analysis table shows every question by ref plus a
	// header row: "Dificultad" is one of the columns.
	if !strings.Contains(body, "Análisis por pregunta") {
		t.Errorf("item analysis section header missing")
	}
	if !strings.Contains(body, "Dificultad") {
		t.Errorf("item analysis column header 'Dificultad' missing")
	}
	// The two questions (q3, q4) both appear as rows.
	if !strings.Contains(body, "q3") || !strings.Contains(body, "q4") {
		t.Errorf("item analysis rows missing q3/q4\n--- body ---\n%s", body)
	}
}

func TestDetailShowsStatsPanelWhenGraded(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control cerrado", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	// Close the correction. The Detail request below runs against the
	// post-close state.
	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/close", nil)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.CloseCorrection(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("close status = %d, want 303", rec.Code)
	}

	body := getDetail(t, f, controlID)
	if !strings.Contains(body, `id="estadisticas"`) {
		t.Fatalf("stats panel not rendered after close\n--- body ---\n%s", body)
	}
	// The "N rendidos = X (de Y copias)" line surfaces the AC-3
	// difference between N and TotalCopies.
	if !strings.Contains(body, "rendidos") {
		t.Errorf("stats panel missing the N-rendidos line\n--- body ---\n%s", body)
	}
	// One copy, one full-point simple question and one full-point
	// multiple → 2/2 → 7.0. The panel prints the mean.
	if !strings.Contains(body, "7.0") {
		t.Errorf("stats panel missing the 7.0 mean\n--- body ---\n%s", body)
	}
}
