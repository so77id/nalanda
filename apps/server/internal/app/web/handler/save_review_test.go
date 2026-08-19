package handler_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

func TestSaveReviewOverridesLandAndFlashConfirms(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control save", 1)

	// A doubtful mark on the simple question — the professor will
	// override it to a confident answer.
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{
			"1": {RUT: "20111111", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusNeedsReview,
				ExpectedQuestions: 2, SeenQuestions: 2,
				Answers: []controls.ReportAnswer{
					{Question: 1, Name: "q3", Type: controls.QuestionSimple,
						Marked: nil, Status: controls.AnswerStatusDoubtful,
						Doubtful: []controls.Doubtful{{Answer: 1, Darkness: 0.15}},
						Score:    0, Max: 1},
					{Question: 2, Name: "q4", Type: controls.QuestionMultiple,
						Marked: []int{1}, Status: controls.AnswerStatusOK, Score: 4, Max: 4},
				}},
		}},
	}
	uploadOnce(t, f, controlID)

	// Simulate the form: RUT unchanged, override q3 to option 1.
	values := url.Values{}
	values.Set("rut", "20111111")
	values.Set("qq3", "1") // simple: one value
	values.Set("qq4", "1") // multiple: unchanged (still option 1)
	values.Set("save", "1")

	req := httptest.NewRequest(http.MethodPost, "/controls/"+controlID+"/copies/1/review",
		strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	req = req.WithContext(f.authedRequest(t, http.MethodPost, "/", nil).Context())
	rec := httptest.NewRecorder()
	f.handler.SaveReview(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("save status = %d\nbody: %s", rec.Code, rec.Body.String())
	}
	// The override landed — the reading now carries an override on q3.
	reading, err := f.service.ReadingFor(f.authedRequest(t, http.MethodGet, "/", nil).Context(), controlID, 1)
	if err != nil {
		t.Fatalf("ReadingFor: %v", err)
	}
	var q3 *controls.Answer
	for i := range reading.Answers {
		if reading.Answers[i].QuestionRef == "q3" {
			q3 = &reading.Answers[i]
		}
	}
	if q3 == nil || q3.Override == nil {
		t.Fatalf("q3 override = %+v", q3)
	}
	if q3.Override.Status != controls.AnswerStatusOK || len(q3.Override.Marked) != 1 || q3.Override.Marked[0] != 1 {
		t.Errorf("q3 override wrong = %+v", q3.Override)
	}

	// Issue #190, ruta B: the save triggered the annotate with exactly the
	// override it just wrote, and the record reflects the moment of the
	// save.
	if count := f.fake.AnnotateCallCount(); count != 1 {
		t.Fatalf("AnnotateCallCount = %d, want 1", count)
	}
	call, _ := f.fake.LastAnnotateCall()
	if call.Copy != 1 {
		t.Errorf("annotate copy = %d, want 1", call.Copy)
	}
	if call.Overrides.RUT != nil {
		t.Errorf("RUT override = %v, want none (the form left the RUT unchanged)", *call.Overrides.RUT)
	}
	if len(call.Overrides.Answers) != 1 || call.Overrides.Answers[0].Question != "q3" ||
		len(call.Overrides.Answers[0].Marked) != 1 || call.Overrides.Answers[0].Marked[0] != 1 {
		t.Errorf("answer overrides = %+v, want exactly q3 marked [1]", call.Overrides.Answers)
	}

	record, exists, err := f.cstore.AnnotatedByCopy(context.Background(), controlID, 1)
	if err != nil || !exists {
		t.Fatalf("annotated_copy row: exists=%v err=%v", exists, err)
	}
	if d := time.Since(record.GeneratedAt); d > 5*time.Second || d < -5*time.Second {
		t.Errorf("GeneratedAt = %v, now = %v — want the moment of the save", record.GeneratedAt, time.Now())
	}
	if record.Path == "" {
		t.Error("annotated_copy path is empty")
	}
}

func TestSaveReviewBlankButtonClearsAnswer(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control blank", 1)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{
			"1": {RUT: "20111111", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusNeedsReview,
				ExpectedQuestions: 2, SeenQuestions: 2,
				Answers: []controls.ReportAnswer{
					{Question: 1, Name: "q3", Type: controls.QuestionSimple, Marked: []int{1},
						Status: controls.AnswerStatusOK, Score: 1, Max: 1},
					{Question: 2, Name: "q4", Type: controls.QuestionMultiple, Marked: []int{1},
						Status: controls.AnswerStatusOK, Score: 4, Max: 4},
				}},
		}},
	}
	uploadOnce(t, f, controlID)

	values := url.Values{}
	values.Set("rut", "20111111")
	values.Set("blank", "q3")
	req := httptest.NewRequest(http.MethodPost, "/controls/"+controlID+"/copies/1/review",
		strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	req = req.WithContext(f.authedRequest(t, http.MethodPost, "/", nil).Context())
	rec := httptest.NewRecorder()
	f.handler.SaveReview(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("save status = %d", rec.Code)
	}
	reading, _ := f.service.ReadingFor(f.authedRequest(t, http.MethodGet, "/", nil).Context(), controlID, 1)
	for _, a := range reading.Answers {
		if a.QuestionRef == "q3" {
			if a.Override == nil || a.Override.Status != controls.AnswerStatusBlank {
				t.Errorf("q3 not blanked: %+v", a.Override)
			}
		}
	}
}
