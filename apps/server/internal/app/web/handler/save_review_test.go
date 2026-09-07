package handler_test

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
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

// TestSaveReviewAcceptsMarksBeyondScoringWeight pins the regression fixed
// post-#234: the SEC-2 cap must use the question's bank alternative COUNT,
// not `Answer.Max` (which is the scoring weight — 1 for a simple, N for a
// multiple's number-of-correct). The old code rejected any mark index > Max
// on a simple question, so any copy where AMC read option B, C, or D was
// unsavable — every re-submit came back with "El formulario tiene un valor
// inválido." (reported 2026-08-27 against Control 2 copy 9).
//
// The fixture's q3 has Max=1 (simple) but the bank declares 2 alternatives
// ("a", "b"); marking option 2 must land, not refuse.
func TestSaveReviewAcceptsMarksBeyondScoringWeight(t *testing.T) {
	f, controlID := saveReviewFixture(t)
	values := url.Values{}
	values.Set("rut", "20111111") // unchanged
	values.Set("qq3", "2")        // Max=1 but bank has 2 alternatives → must land
	values.Set("qq4", "1")        // unchanged

	rec := postSaveReview(t, f, controlID, 1, values)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d\nbody: %s", rec.Code, rec.Body.String())
	}
	got := flashFromResponse(t, rec)
	if got == "El formulario tiene un valor inválido." {
		t.Fatalf("SEC-2 cap rejected a mark within the question's real alternative count — pre-fix behaviour: got %q", got)
	}
	// Positive: the answer moved from [1] to [2].
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
	if q3 == nil || q3.Override == nil || len(q3.Override.Marked) != 1 || q3.Override.Marked[0] != 2 {
		t.Fatalf("q3 override did not persist mark [2]: %+v", q3)
	}
	if want := "Cambios en 1 respuesta."; got != want {
		t.Errorf("flash = %q, want %q — the move on q3 must be reported", got, want)
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

// --- Issue #272 S4: the manual RUT edit rematches. ---

// Correcting a misread RUT to one that IS on the roster files the copy
// under that student, without a second click.
//
// This is the flow the whole reconciliation queue exists for: AMC could
// not read the boxes, the professor reads them off the scan and types
// them, and the copy stops being anonymous. Leaving the association to a
// later re-read would mean the queue never empties by working it.
func TestSavingACorrectedRUTMatchesTheCopyToItsStudent(t *testing.T) {
	f := newControlsFixture(t)
	ctx := context.Background()

	if _, err := f.roster.Store.SaveRoster(ctx, f.courseID, []roster.SourceStudent{
		{FirstName: "Ana", LastName: "Pérez", RUT: "20100001", RUTDV: "5", CanvasUserID: "canvas-ana"},
	}); err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}
	controlID := f.createControlOnCourse(t, "Control con curso", 1, &f.courseID)

	// AMC read the RUT wrongly: eight legible digits belonging to nobody.
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100999")}},
	}
	uploadOnce(t, f, controlID)

	readings, err := f.service.ReadingsFor(ctx, controlID)
	if err != nil {
		t.Fatalf("ReadingsFor: %v", err)
	}
	if got := readings[0].StudentID; got != nil {
		t.Fatalf("precondition: copy 1 student = %d, want nil", *got)
	}

	f.saveReviewRUT(t, controlID, 1, "20100001")

	readings, err = f.service.ReadingsFor(ctx, controlID)
	if err != nil {
		t.Fatalf("ReadingsFor after the edit: %v", err)
	}
	anaID := f.studentID(t, "canvas-ana")
	if got := readings[0].StudentID; got == nil || *got != anaID {
		t.Errorf("copy 1 student = %v after correcting the RUT, want Ana (%d)", got, anaID)
	}
}

// And the reverse: editing a RUT away from a student unfiles the copy.
//
// The write is authoritative, so a professor who corrected the wrong copy
// can undo it by correcting the RUT back. A one-way association would
// leave the first mistake in place with no way to see or reach it.
func TestSavingARUTThatMatchesNobodyClearsTheStudent(t *testing.T) {
	f := newControlsFixture(t)
	ctx := context.Background()

	if _, err := f.roster.Store.SaveRoster(ctx, f.courseID, []roster.SourceStudent{
		{FirstName: "Ana", LastName: "Pérez", RUT: "20100001", RUTDV: "5", CanvasUserID: "canvas-ana"},
	}); err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}
	controlID := f.createControlOnCourse(t, "Control con curso", 1, &f.courseID)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	readings, err := f.service.ReadingsFor(ctx, controlID)
	if err != nil {
		t.Fatalf("ReadingsFor: %v", err)
	}
	if got := readings[0].StudentID; got == nil {
		t.Fatal("precondition: copy 1 matched nobody, want Ana")
	}

	f.saveReviewRUT(t, controlID, 1, "20100999")

	readings, err = f.service.ReadingsFor(ctx, controlID)
	if err != nil {
		t.Fatalf("ReadingsFor after the edit: %v", err)
	}
	if got := readings[0].StudentID; got != nil {
		t.Errorf("copy 1 student = %d after the RUT stopped matching, want nil", *got)
	}
}

// The review page says WHICH kind of unresolved RUT this is.
//
// Before this WP a copy needing attention had one reason: AMC could not
// read the boxes. There are two now, they look identical in the RUT
// field, and they need opposite actions — an illegible RUT is fixed by
// reading the scan and typing it, a RUT that is simply not on the roster
// is fixed in Canvas and re-imported. Rendering both as a bare input is
// how a professor retypes the same correct digits three times.
func TestTheReviewPageNamesWhyAReadableRUTIsUnmatched(t *testing.T) {
	f := newControlsFixture(t)
	ctx := context.Background()

	if _, err := f.roster.Store.SaveRoster(ctx, f.courseID, []roster.SourceStudent{
		{FirstName: "Ana", LastName: "Pérez", RUT: "20100001", RUTDV: "5", CanvasUserID: "canvas-ana"},
	}); err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}
	controlID := f.createControlOnCourse(t, "Control con curso", 2, &f.courseID)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{
			"1": okCopy("20100001"), // on the roster
			"2": okCopy("20100999"), // legible, on no roster
		}},
	}
	uploadOnce(t, f, controlID)

	unmatched := f.reviewBody(t, controlID, 2)
	if !strings.Contains(unmatched, "no está en la lista") {
		t.Errorf("the review page of an unmatched copy does not say the RUT is not on the roster:\n%s", unmatched)
	}

	matched := f.reviewBody(t, controlID, 1)
	if strings.Contains(matched, "no está en la lista") {
		t.Error("the review page of a MATCHED copy claims the RUT is not on the roster")
	}
}

// A control with no course says nothing at all.
//
// Every copy of such a control is unmatched, and it is unmatched because
// nobody has told the server which class sat it — not because the RUT is
// wrong. Rendering "no está en la lista" on all of them would send the
// professor to Canvas to fix data that is already correct.
func TestTheReviewPageSaysNothingAboutTheRosterWhenTheControlHasNoCourse(t *testing.T) {
	f := newControlsFixture(t)
	ctx := context.Background()

	if _, err := f.roster.Store.SaveRoster(ctx, f.courseID, []roster.SourceStudent{
		{FirstName: "Ana", LastName: "Pérez", RUT: "20100001", RUTDV: "5", CanvasUserID: "canvas-ana"},
	}); err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}
	controlID := f.createControlOnCourse(t, "Control histórico", 1, nil)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100999")}},
	}
	uploadOnce(t, f, controlID)

	body := f.reviewBody(t, controlID, 1)
	if strings.Contains(body, "no está en la lista") {
		t.Error("a control with no course claims the RUT is not on the roster; " +
			"it has no roster to be absent from")
	}
}

// saveReviewRUT posts the review form with a corrected RUT, the way the
// browser does.
func (f *controlsFixture) saveReviewRUT(t *testing.T, controlID string, copyNumber int, rut string) {
	t.Helper()
	form := url.Values{"rut": {rut}, "csrf_token": {"csrf-1"}}
	req := f.authedRequest(t, http.MethodPost,
		fmt.Sprintf("/controls/%s/copies/%d/review", controlID, copyNumber), form)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", strconv.Itoa(copyNumber))
	rec := httptest.NewRecorder()
	f.handler.SaveReview(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("SaveReview status = %d, want 303; body:\n%s", rec.Code, rec.Body.String())
	}
}

// reviewBody renders one copy's review page and returns the HTML.
func (f *controlsFixture) reviewBody(t *testing.T, controlID string, copyNumber int) string {
	t.Helper()
	req := f.authedRequest(t, http.MethodGet,
		fmt.Sprintf("/controls/%s/copies/%d/review", controlID, copyNumber), nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", strconv.Itoa(copyNumber))
	rec := httptest.NewRecorder()
	f.handler.Review(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("Review status = %d, want 200; body:\n%s", rec.Code, rec.Body.String())
	}
	return rec.Body.String()
}

// An ILLEGIBLE RUT is not an off-roster RUT, and the page must not
// confuse the two.
//
// This is the case the first version of NotInRoster got wrong (#272
// review, COR-1). The gate tested `effectiveReviewRUT(r) != ""` on the
// belief that an unreadable read arrives empty — it does not. AMC sends
// the partial digits with `_` / `[…]` sentinels (`read_capture.py`; the
// store's own upsertReading comment says both shapes are persisted
// verbatim), so `2011111_` is non-empty and every smudged copy on a
// course-bearing control was told its student was missing from Canvas.
//
// The two need OPPOSITE actions: an illegible RUT is fixed by reading
// the scan and typing it, an off-roster RUT is fixed in Canvas and
// re-imported. Sending a professor to Canvas over a smudge is the worst
// of the two mistakes, because nothing there is wrong to find.
func TestAnIllegibleRUTIsNotReportedAsMissingFromTheRoster(t *testing.T) {
	f := newControlsFixture(t)
	ctx := context.Background()

	if _, err := f.roster.Store.SaveRoster(ctx, f.courseID, []roster.SourceStudent{
		{FirstName: "Ana", LastName: "Pérez", RUT: "20100001", RUTDV: "5", CanvasUserID: "canvas-ana"},
	}); err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}
	controlID := f.createControlOnCourse(t, "Control con curso", 2, &f.courseID)

	// Copy 1: AMC could not read the boxes, and says so the way it
	// actually says it — partial digits plus a sentinel, NOT an empty
	// string. Copy 2: eight clean digits belonging to nobody.
	illegible := okCopy("2010000_")
	illegible.RUTStatus = controls.RUTStatusUnreadable
	illegible.Status = controls.CopyStatusNeedsReview
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{
			"1": illegible,
			"2": okCopy("20100999"),
		}},
	}
	uploadOnce(t, f, controlID)

	if body := f.reviewBody(t, controlID, 1); strings.Contains(body, "no está en la lista") {
		t.Errorf("an illegible RUT is reported as missing from the roster, which sends the "+
			"professor to Canvas over a smudge:\n%s", body)
	}
	// The legible-but-unknown copy still gets the message — the fix must
	// not silence the case the field exists for.
	if body := f.reviewBody(t, controlID, 2); !strings.Contains(body, "no está en la lista") {
		t.Errorf("a legible off-roster RUT lost its message:\n%s", body)
	}
}

// Clearing an override by retyping what AMC read re-files the copy under
// the AMC read's student.
//
// This is SaveOverrides's `matched_read` branch, and it MOVES the
// effective RUT — from the override's value back to AMC's — so it has to
// rematch. Nothing drove it before (#272 review, COR-6): narrowing the
// gate to RUTActionUpdated left the whole suite green, and would have
// left the copy filed under the person the deleted override named.
func TestClearingAnOverrideRefilesTheCopyUnderTheAMCRead(t *testing.T) {
	f := newControlsFixture(t)
	ctx := context.Background()

	// Two students, both on the roster: AMC read one, the professor
	// overrode to the other, and then changes their mind.
	if _, err := f.roster.Store.SaveRoster(ctx, f.courseID, []roster.SourceStudent{
		{FirstName: "Ana", LastName: "Pérez", RUT: "20100001", RUTDV: "5", CanvasUserID: "canvas-ana"},
		{FirstName: "Bruno", LastName: "Soto", RUT: "20100002", RUTDV: "1", CanvasUserID: "canvas-bruno"},
	}); err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}
	controlID := f.createControlOnCourse(t, "Control con curso", 1, &f.courseID)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}}, // AMC read Ana
	}
	uploadOnce(t, f, controlID)

	anaID := f.studentID(t, "canvas-ana")
	brunoID := f.studentID(t, "canvas-bruno")

	// The professor overrides to Bruno.
	f.saveReviewRUT(t, controlID, 1, "20100002")
	readings, err := f.service.ReadingsFor(ctx, controlID)
	if err != nil {
		t.Fatalf("ReadingsFor: %v", err)
	}
	if got := readings[0].StudentID; got == nil || *got != brunoID {
		t.Fatalf("precondition: copy 1 student = %v, want Bruno (%d)", got, brunoID)
	}

	// And then puts back exactly what AMC read, which CLEARS the
	// override rather than storing a new one.
	f.saveReviewRUT(t, controlID, 1, "20100001")

	readings, err = f.service.ReadingsFor(ctx, controlID)
	if err != nil {
		t.Fatalf("ReadingsFor after clearing the override: %v", err)
	}
	if readings[0].RUTOverride != nil {
		t.Errorf("the override survived a submission equal to the AMC read: %+v", readings[0].RUTOverride)
	}
	if got := readings[0].StudentID; got == nil || *got != anaID {
		t.Errorf("copy 1 student = %v after the override was cleared, want Ana (%d) — "+
			"the effective RUT moved and the association did not follow", got, anaID)
	}
}
