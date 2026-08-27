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
