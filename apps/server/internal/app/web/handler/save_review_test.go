package handler_test

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// flashFromResponse decodes the flash cookie the handler set on rec.
// Returns empty when there is none. The cookie is base64url-encoded per
// flash.Set — the raw string can carry "\n" for a multi-line flash.
func flashFromResponse(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name != flash.CookieName || c.Value == "" || c.MaxAge < 0 {
			continue
		}
		b, err := base64.URLEncoding.DecodeString(c.Value)
		if err != nil {
			t.Fatalf("flash cookie decode: %v", err)
		}
		return string(b)
	}
	return ""
}

// saveReviewFixture returns a fixture already set up with one uploaded
// scan reporting RUT 20111111 and two OK answers on copy 1 — the shape
// the RUT flash cases in this file build on.
func saveReviewFixture(t *testing.T) (*controlsFixture, string) {
	t.Helper()
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control S3", 1)
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
	return f, controlID
}

// postSaveReview POSTs the given form values against SaveReview for the
// given control/copy and returns the recorder. Marshalled so a case body
// reads at the level of intent ("post rut, keep answers as read") rather
// than mux plumbing.
func postSaveReview(t *testing.T, f *controlsFixture, controlID string, copy int, values url.Values) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost,
		"/controls/"+controlID+"/copies/1/review",
		strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", "1")
	req = req.WithContext(f.authedRequest(t, http.MethodPost, "/", nil).Context())
	rec := httptest.NewRecorder()
	f.handler.SaveReview(rec, req)
	return rec
}

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

// The S3 cases below cover issue #228's RUT feedback + redirect + flash
// granularity work. See handler/review.go:buildSaveReviewFlash.

// TestSaveReviewRedirectsToTheReviewPageNotDetail pins the redirect
// target change (S3): the professor stays on the page they just
// submitted, so the RUT `(editado por ti)` marker AND the flash are
// visible together. Every S3 case below inherits this expectation.
func TestSaveReviewRedirectsToTheReviewPageNotDetail(t *testing.T) {
	f, controlID := saveReviewFixture(t)
	values := url.Values{}
	values.Set("rut", "20111111")
	values.Set("qq3", "1")
	values.Set("qq4", "1")
	values.Set("save", "1")

	rec := postSaveReview(t, f, controlID, 1, values)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d\nbody: %s", rec.Code, rec.Body.String())
	}
	want := "/controls/" + controlID + "/copies/1/review"
	if got := rec.Header().Get("Location"); got != want {
		t.Errorf("Location = %q, want %q — the S3 fix keeps the professor on the review page", got, want)
	}
}

// TestSaveReviewRefusesEmptyRUTWithFlash pins the S3 rejection of an
// empty RUT: the domain used to silently ignore it and flash
// "Cambios guardados." anyway (S2 diagnosis, empty branch of the
// SaveOverrides switch). Refusing here surfaces the mistake.
func TestSaveReviewRefusesEmptyRUTWithFlash(t *testing.T) {
	f, controlID := saveReviewFixture(t)
	values := url.Values{}
	values.Set("rut", "") // the case
	values.Set("qq3", "1")
	values.Set("qq4", "1")
	values.Set("save", "1")

	rec := postSaveReview(t, f, controlID, 1, values)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d", rec.Code)
	}
	if got, want := flashFromResponse(t, rec), "El RUT no puede quedar vacío."; got != want {
		t.Errorf("flash = %q, want %q", got, want)
	}
	// No override was written — the request was refused before the domain
	// call, so the reading stays exactly as AMC read it.
	reading, _ := f.service.ReadingFor(context.Background(), controlID, 1)
	if reading.RUTOverride != nil {
		t.Errorf("RUT override = %+v, want none — the empty submission was refused", reading.RUTOverride)
	}
}

// TestSaveReviewRefusesInvalidRUTWithFlash pins the existing
// eight-digit-only refusal (SEC-1) still flashes.
func TestSaveReviewRefusesInvalidRUTWithFlash(t *testing.T) {
	f, controlID := saveReviewFixture(t)
	values := url.Values{}
	values.Set("rut", "1234") // too short
	values.Set("qq3", "1")
	values.Set("qq4", "1")
	values.Set("save", "1")

	rec := postSaveReview(t, f, controlID, 1, values)

	if got, want := flashFromResponse(t, rec), "El RUT debe tener 8 dígitos."; got != want {
		t.Errorf("flash = %q, want %q", got, want)
	}
}

// TestSaveReviewFlashesRUTUpdatedWhenTheValueChanges pins the flash for
// a new override that differs from what AMC read. This is the branch
// that actually changed something Miguel typed.
func TestSaveReviewFlashesRUTUpdatedWhenTheValueChanges(t *testing.T) {
	f, controlID := saveReviewFixture(t)
	values := url.Values{}
	values.Set("rut", "20222222") // differs from the AMC-read 20111111
	values.Set("qq3", "1")
	values.Set("qq4", "1")
	values.Set("save", "1")

	rec := postSaveReview(t, f, controlID, 1, values)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d", rec.Code)
	}
	if got, want := flashFromResponse(t, rec), "RUT actualizado a 20222222."; got != want {
		t.Errorf("flash = %q, want %q", got, want)
	}
	// The override landed. Reading it back confirms the persist.
	reading, _ := f.service.ReadingFor(context.Background(), controlID, 1)
	if reading.RUTOverride == nil || reading.RUTOverride.RUT != "20222222" {
		t.Errorf("RUT override = %+v, want the new value", reading.RUTOverride)
	}
}

// TestSaveReviewFlashesRUTMatchedReadWhenClearingOverride pins the H1
// bug from the S2 diagnosis. Setup: an override exists that differs
// from AMC's read. The professor types the AMC-read value back → the
// override is CLEARED. Before S3, the flash said "Cambios guardados."
// and the review page came back looking untouched; the professor read
// that as "nothing persisted". After S3 the flash names the branch.
func TestSaveReviewFlashesRUTMatchedReadWhenClearingOverride(t *testing.T) {
	f, controlID := saveReviewFixture(t)
	// First save: write an override that differs from AMC. That is the
	// state Miguel would have arrived at from a prior edit.
	values := url.Values{}
	values.Set("rut", "20999999")
	values.Set("qq3", "1")
	values.Set("qq4", "1")
	values.Set("save", "1")
	_ = postSaveReview(t, f, controlID, 1, values)

	// Second save: the professor types the AMC value back. The domain
	// clears the override (ClearRUTOverride branch, scans.go). The
	// flash must name what happened rather than saying "Cambios
	// guardados."
	values.Set("rut", "20111111") // == AMC-read
	rec := postSaveReview(t, f, controlID, 1, values)

	if got, want := flashFromResponse(t, rec), "RUT vuelto al valor leído por AMC."; got != want {
		t.Errorf("flash = %q, want %q — S3 makes the ClearRUTOverride branch visible", got, want)
	}
	// The override is gone: only the AMC-read value survives.
	reading, _ := f.service.ReadingFor(context.Background(), controlID, 1)
	if reading.RUTOverride != nil {
		t.Errorf("RUT override = %+v, want none — the ClearRUTOverride branch fires when the submission matches AMC", reading.RUTOverride)
	}
}

// TestSaveReviewFlashesSinCambiosWhenNothingMoved pins the "no-op save"
// case: the professor clicked Guardar without changing anything. Before
// S3 it flashed "Cambios guardados." and hid the fact that no override
// was written; now the flash names the outcome so a professor does not
// mis-read it as a persist.
func TestSaveReviewFlashesSinCambiosWhenNothingMoved(t *testing.T) {
	f, controlID := saveReviewFixture(t)
	values := url.Values{}
	values.Set("rut", "20111111") // == AMC-read, no override existed
	values.Set("qq3", "1")        // == AMC-read
	values.Set("qq4", "1")        // == AMC-read
	values.Set("save", "1")

	rec := postSaveReview(t, f, controlID, 1, values)

	if got, want := flashFromResponse(t, rec), "Sin cambios."; got != want {
		t.Errorf("flash = %q, want %q", got, want)
	}
}

// TestSaveReviewFlashesAnswerCountWhenOnlyAnswersMove pins the answer-
// only flash. The RUT is left as read, one answer is changed, the flash
// names the count.
func TestSaveReviewFlashesAnswerCountWhenOnlyAnswersMove(t *testing.T) {
	f, controlID := saveReviewFixture(t)
	values := url.Values{}
	values.Set("rut", "20111111") // == AMC-read
	values.Set("qq3", "1")        // == AMC-read
	values.Set("qq4", "2")        // was 1 (q4 is multiple, Max=4 so 2 is valid)
	values.Set("save", "1")

	rec := postSaveReview(t, f, controlID, 1, values)

	if got, want := flashFromResponse(t, rec), "Cambios en 1 respuesta."; got != want {
		t.Errorf("flash = %q, want %q", got, want)
	}
}

// TestSaveReviewFlashesBothRUTAndAnswersOnOneSubmit pins the multi-line
// flash: two actions in one submit produce two lines joined by "\n",
// which the layout template renders as a `<ul>` in a single
// `.flash` container.
func TestSaveReviewFlashesBothRUTAndAnswersOnOneSubmit(t *testing.T) {
	f, controlID := saveReviewFixture(t)
	values := url.Values{}
	values.Set("rut", "20222222") // updated
	values.Set("qq3", "1")        // unchanged
	values.Set("qq4", "2")        // was 1 → answer moves
	values.Set("save", "1")

	rec := postSaveReview(t, f, controlID, 1, values)

	got := flashFromResponse(t, rec)
	want := "RUT actualizado a 20222222.\nCambios en 1 respuesta."
	if got != want {
		t.Errorf("flash = %q, want %q — S3 joins per-action lines with \\n", got, want)
	}
}

// TestSaveReviewBlankButtonAcceptsEmptyRUT pins COR-3 (S3 review): on a
// copy where AMC never read the RUT, the input renders with `value=""`;
// clicking the "Marcar en blanco" question button submits `rut=""`, and
// the previous revision refused with `El RUT no puede quedar vacío`,
// silently dropping the blanking. The blank click is orthogonal to the
// RUT edit — the button's purpose is to blank one answer, not to force a
// RUT. Now the submission is accepted, the answer is blanked, and the
// flash names the blank.
func TestSaveReviewBlankButtonAcceptsEmptyRUT(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control blank empty RUT", 1)
	// A copy AMC could not read the RUT for — RUTStatus=NotPresent, no
	// RUTRead, no override. This is the state where `toReviewRUT`
	// renders the input with value="".
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{
			"1": {RUT: "", RUTStatus: controls.RUTStatusNotPresent, Status: controls.CopyStatusNeedsReview,
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
	values.Set("rut", "") // the case: no RUT typed, blank button clicked
	values.Set("qq3", "1")
	values.Set("qq4", "1")
	values.Set("blank", "q3")

	rec := postSaveReview(t, f, controlID, 1, values)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d\nbody: %s", rec.Code, rec.Body.String())
	}
	// The blanking landed — q3 has a blank override.
	reading, _ := f.service.ReadingFor(context.Background(), controlID, 1)
	var q3 *controls.Answer
	for i := range reading.Answers {
		if reading.Answers[i].QuestionRef == "q3" {
			q3 = &reading.Answers[i]
		}
	}
	if q3 == nil || q3.Override == nil || q3.Override.Status != controls.AnswerStatusBlank {
		t.Fatalf("q3 was not blanked: %+v", q3)
	}
	// Flash names the blank, not a RUT rejection.
	if got, want := flashFromResponse(t, rec), "Pregunta q3 marcada en blanco."; got != want {
		t.Errorf("flash = %q, want %q — COR-3: blank click must not be refused for empty RUT", got, want)
	}
}

// TestSaveReviewBlankButtonAlsoReportsOtherMovedAnswers pins COR-5: when
// the professor mid-edits other radios and then clicks the blank button,
// the count of OTHER moves is not swallowed by the blank line.
func TestSaveReviewBlankButtonAlsoReportsOtherMovedAnswers(t *testing.T) {
	f, controlID := saveReviewFixture(t)
	values := url.Values{}
	values.Set("rut", "20111111") // == AMC-read
	values.Set("qq3", "1")        // == AMC-read (no move)
	values.Set("qq4", "2")        // was 1 → moves
	values.Set("blank", "q3")     // ALSO blanks q3 → 2 answers touched total

	rec := postSaveReview(t, f, controlID, 1, values)

	got := flashFromResponse(t, rec)
	want := "Pregunta q3 marcada en blanco.\nCambios en 1 respuesta."
	if got != want {
		t.Errorf("flash = %q, want %q — COR-5: the mid-blank submission must still report the other move", got, want)
	}
}
