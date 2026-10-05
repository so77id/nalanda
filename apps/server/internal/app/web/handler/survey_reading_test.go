package handler_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey/tex"
)

// Issue #311: a run's scans, read and reviewed. The service runs against
// the real store and the amctest fake worker (testing-strategy.md L6).

// readableRun is a generated run of the three-question bank, and its
// questions: single "¿Ritmo?" (lento, rápido), scale "¿Clara?" (5 points),
// context "¿Sección?" (A, B).
type readableRun struct {
	s                       survey.Survey
	run                     survey.Run
	single, scale, contextQ survey.Question
}

func (f *surveyFixture) readableRun() readableRun {
	f.t.Helper()
	s := f.createSurvey("Banco")
	single, scale, contextQ := f.bankOfThree(s)
	run := f.createRunThroughTheForm(s, "")
	f.finishGeneration(s, run)
	return readableRun{s: s, run: run, single: single, scale: scale, contextQ: contextQ}
}

// answer is one ReportAnswer on question q.
func answer(q survey.Question, status survey.AnswerStatus, marked []int, doubtful ...int) survey.ReportAnswer {
	return survey.ReportAnswer{Name: tex.QuestionName(q.ID), Status: status, Marked: marked, Doubtful: doubtful}
}

// analyse runs the survey_analyse job of batch over the run, the way the
// runner would.
func (f *surveyFixture) analyse(r readableRun, batch string) error {
	f.t.Helper()
	return survey.NewAnalyseHandler(f.surveys)(context.Background(),
		strconv.FormatInt(r.run.ID, 10), survey.EncodeAnalysePayload(r.s.ID, batch))
}

func TestAnAnalysedBatchStoresMarksAndItemsAndSaysWhatItRead(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	f.worker.SurveyReports = []survey.Report{{
		Batch: &survey.Batch{Captured: 2, Failed: 1},
		Copies: []survey.ReportCopy{
			{CopyNumber: 1, Pages: []int{1}, Answers: []survey.ReportAnswer{
				answer(r.single, survey.AnswerOK, []int{2}),
				answer(r.scale, survey.AnswerOK, []int{4}),
				answer(r.contextQ, survey.AnswerBlank, nil),
			}},
			{CopyNumber: 2, Pages: []int{2}, Answers: []survey.ReportAnswer{
				answer(r.single, survey.AnswerAmbiguous, []int{1, 2}),
				answer(r.scale, survey.AnswerDoubtful, nil, 3),
				answer(r.contextQ, survey.AnswerOK, []int{1}),
			}},
		},
	}}

	err := f.analyse(r, "batch-1.pdf")
	var notice *jobs.Notice
	if !errors.As(err, &notice) {
		t.Fatalf("the job returned %v, want a done job's notice", err)
	}
	for _, want := range []string{"2 página(s)", "2 copia(s) leída(s)", "1 por revisar", "1 página(s) no se reconocieron"} {
		if !strings.Contains(notice.Message, want) {
			t.Errorf("notice %q lacks %q", notice.Message, want)
		}
	}
	call := f.worker.SurveyAnalyzeCalls[0]
	if !strings.HasSuffix(call.ScanPDF, "/uploads/batch-1.pdf") || !strings.HasSuffix(call.Source, "/inputs/source.tex") ||
		call.Ticked != survey.DefaultTicked || call.Unsure != survey.DefaultUnsure {
		t.Errorf("the worker was asked %+v", call)
	}

	ctx := context.Background()
	counts, err := f.surveys.ReadingCounts(ctx, r.run.ID)
	if err != nil || counts != (survey.ReadingCounts{Copies: 2, PendingCopies: 1, PendingItems: 2}) {
		t.Errorf("counts = %+v, %v", counts, err)
	}
	one, err := f.surveys.CopyReading(ctx, r.run.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(one.Marks) != 2 || one.Marks[0].AlternativeID != r.single.Alternatives[1].ID || one.Marks[1].AlternativeID != r.scale.Alternatives[3].ID {
		t.Errorf("copy 1's marks = %+v", one.Marks)
	}
	two, _ := f.surveys.CopyReading(ctx, r.run.ID, 2)
	if len(two.Marks) != 1 || len(two.Items) != 2 {
		t.Errorf("copy 2 = %d marks, %d items; want the context mark and two items", len(two.Marks), len(two.Items))
	}
}

func TestABatchThatStoresNothingSaysWhy(t *testing.T) {
	cases := map[string]struct {
		report survey.Report
		err    error
		want   string
	}{
		"no page of this run": {
			report: survey.Report{Batch: &survey.Batch{Captured: 0, Failed: 3}},
			want:   "Ninguna página de ese PDF es de esta pasada",
		},
		"a question the run never printed": {
			report: survey.Report{Batch: &survey.Batch{Captured: 1}, Copies: []survey.ReportCopy{{CopyNumber: 1, Answers: []survey.ReportAnswer{
				{Name: "q999", Status: survey.AnswerOK, Marked: []int{1}},
			}}}},
			want: "La lectura no coincide",
		},
		"the worker refusing": {err: survey.ErrAnalyzerRefused, want: "rechazó el lote"},
		"the worker away":     {err: survey.ErrAnalyzerUnavailable, want: "no responde"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			f := newSurveyFixture(t)
			r := f.readableRun()
			f.worker.SurveyReports = []survey.Report{tc.report}
			f.worker.SurveyAnalyzeErr = tc.err

			err := f.analyse(r, "batch-1.pdf")
			var failure *jobs.Failure
			if !errors.As(err, &failure) || !strings.Contains(failure.Message, tc.want) {
				t.Fatalf("the job returned %v, want a failure saying %q", err, tc.want)
			}
			if counts, _ := f.surveys.ReadingCounts(context.Background(), r.run.ID); counts.Copies != 0 {
				t.Errorf("%d copies stored by a batch that failed", counts.Copies)
			}
		})
	}
}

func TestACancelledRunIsNotRead(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	if err := f.surveys.CancelRun(context.Background(), r.s.ID, r.run.ID); err != nil {
		t.Fatal(err)
	}
	var failure *jobs.Failure
	if err := f.analyse(r, "batch-1.pdf"); !errors.As(err, &failure) || !strings.Contains(failure.Message, "ya no está abierta") {
		t.Fatalf("reading a cancelled run: %v", err)
	}
	if len(f.worker.SurveyAnalyzeCalls) != 0 {
		t.Error("the worker was asked to read a cancelled run")
	}
}

// upload POSTs one scanned batch to the run, through the real middleware.
func (f *surveyFixture) upload(r readableRun, filename, contentType string, body []byte) *httptest.ResponseRecorder {
	f.t.Helper()
	buf, ctype := buildScanUpload(f.t, filename, contentType, body)
	req := httptest.NewRequest(http.MethodPost, handler.SurveyRunScansPathFor(r.s.ID, r.run.ID), buf)
	req.Header.Set("Content-Type", ctype)
	req.AddCookie(&http.Cookie{Name: middleware.SessionCookieName(true), Value: f.session})
	for i, v := range f.runValues(r.s, r.run) {
		if i%2 == 0 {
			req.SetPathValue(v, f.runValues(r.s, r.run)[i+1])
		}
	}
	rec := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(http.HandlerFunc(f.handler.UploadScans))).ServeHTTP(rec, req)
	return rec
}

func TestAnUploadWritesTheBatchBeforeQueueingItsReading(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	scans := handler.SurveyRunScansPathFor(r.s.ID, r.run.ID)

	for n := 1; n <= 2; n++ {
		rec := f.upload(r, "hojas.pdf", "application/pdf", []byte("%PDF-1.4 lote"))
		if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != scans {
			t.Fatalf("upload %d: status %d, location %q", n, rec.Code, rec.Header().Get("Location"))
		}
		name := "batch-" + strconv.Itoa(n) + ".pdf"
		if !strings.Contains(flashOf(t, rec), name) {
			t.Errorf("upload %d's flash = %q, want it to name %s", n, flashOf(t, rec), name)
		}
		path := filepath.Join(f.worker.WorkDir, survey.RunProject(r.s.ID, r.run.ID), "uploads", name)
		if b, err := os.ReadFile(path); err != nil || string(b) != "%PDF-1.4 lote" {
			t.Errorf("batch %d on disk: %q, %v", n, b, err)
		}
		job, err := f.jobs.LatestByKind(context.Background(), strconv.FormatInt(r.run.ID, 10), jobs.KindSurveyAnalyse)
		if err != nil || !strings.Contains(string(job.Payload), name) || job.SubjectKind != jobs.SubjectSurveyRun {
			t.Errorf("upload %d's job = %+v, %v", n, job, err)
		}
	}

	body := f.do(http.MethodGet, scans, f.handler.RunScans, nil, f.runValues(r.s, r.run)...).Body.String()
	for _, want := range []string{"batch-1.pdf", "batch-2.pdf", "Procesando lectura de los escaneos", `enctype="multipart/form-data"`} {
		if !strings.Contains(body, want) {
			t.Errorf("screen 10 lacks %q", want)
		}
	}
	run := f.do(http.MethodGet, handler.SurveyRunPathFor(r.s.ID, r.run.ID), f.handler.RunDetail, nil, f.runValues(r.s, r.run)...).Body.String()
	if !strings.Contains(run, `href="`+scans+`"`) {
		t.Error("the run's dashboard does not link screen 10")
	}
}

func TestAnUploadThatIsNotAPDFOrNotForAnOpenRunWritesNothing(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	if rec := f.upload(r, "hojas.docx", "application/msword", []byte("PK")); !strings.Contains(flashOf(t, rec), "debe ser un PDF") {
		t.Errorf("a .docx: flash %q", flashOf(t, rec))
	}
	if err := f.surveys.CancelRun(context.Background(), r.s.ID, r.run.ID); err != nil {
		t.Fatal(err)
	}
	if rec := f.upload(r, "hojas.pdf", "application/pdf", []byte("%PDF")); !strings.Contains(flashOf(t, rec), "ya no está abierta") {
		t.Errorf("a cancelled run: flash %q", flashOf(t, rec))
	}
	if _, err := os.Stat(filepath.Join(f.worker.WorkDir, survey.RunProject(r.s.ID, r.run.ID), "uploads")); !os.IsNotExist(err) {
		t.Errorf("an uploads directory exists after two refused uploads (%v)", err)
	}
	if _, err := f.jobs.LatestByKind(context.Background(), strconv.FormatInt(r.run.ID, 10), jobs.KindSurveyAnalyse); !errors.Is(err, jobs.ErrJobNotFound) {
		t.Errorf("a reading was queued for a refused upload: %v", err)
	}
}

// reviewable is a run whose batch left copy 2 with two items (an
// ambiguous single, a doubtful scale) and copy 3 with one (a doubtful
// context question); copy 1 is clean.
func (f *surveyFixture) reviewable() readableRun {
	f.t.Helper()
	r := f.readableRun()
	f.worker.SurveyReports = []survey.Report{{
		Batch: &survey.Batch{Captured: 3},
		Copies: []survey.ReportCopy{
			{CopyNumber: 1, Pages: []int{1}, Answers: []survey.ReportAnswer{answer(r.single, survey.AnswerOK, []int{1})}},
			{CopyNumber: 2, Pages: []int{2}, Answers: []survey.ReportAnswer{
				answer(r.single, survey.AnswerAmbiguous, []int{1, 2}),
				answer(r.scale, survey.AnswerDoubtful, nil, 4),
			}},
			{CopyNumber: 3, Pages: []int{3}, Answers: []survey.ReportAnswer{answer(r.contextQ, survey.AnswerDoubtful, nil, 2)}},
		},
	}}
	var notice *jobs.Notice
	if err := f.analyse(r, "batch-1.pdf"); !errors.As(err, &notice) {
		f.t.Fatalf("analysing: %v", err)
	}
	return r
}

func (f *surveyFixture) reviewValues(r readableRun, copyNumber int) []string {
	return append(f.runValues(r.s, r.run), "copy", strconv.Itoa(copyNumber))
}

func TestTheReviewQueueStartsAtTheFirstCopyThatWaits(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.reviewable()
	rec := f.do(http.MethodGet, handler.SurveyRunReviewPathFor(r.s.ID, r.run.ID), f.handler.RunReview, nil, f.runValues(r.s, r.run)...)
	if loc := rec.Header().Get("Location"); loc != handler.SurveyRunReviewCopyPathFor(r.s.ID, r.run.ID, 2) {
		t.Fatalf("the queue starts at %q, want copy 2", loc)
	}

	body := f.do(http.MethodGet, handler.SurveyRunReviewCopyPathFor(r.s.ID, r.run.ID, 2), f.handler.ReviewCopy, nil, f.reviewValues(r, 2)...).Body.String()
	for _, want := range []string{
		"2 copias esperan revisión", "Copia 1 de 2",
		"Se detectaron 2 marcas (lento y rápido) en una pregunta de una sola respuesta.",
		"Marca dudosa en 4 (De acuerdo).", "Escala 1-5",
		handler.SurveyRunPagePathFor(r.s.ID, r.run.ID, 2, 2), "Guardar y seguir",
		`name="choice_`, `value="discard"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("copy 2's review lacks %q", want)
		}
	}
}

func TestResolvingACopyRecordsTheChoiceAndMovesToTheNextOne(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.reviewable()
	ctx := context.Background()
	two, _ := f.surveys.CopyReading(ctx, r.run.ID, 2)
	ambiguous, doubtful := two.Items[0], two.Items[1]
	path := handler.SurveyRunReviewCopyPathFor(r.s.ID, r.run.ID, 2)

	// Two alternatives on a one-answer question: refused, nothing written.
	twoAlts := url.Values{"choice_" + strconv.FormatInt(ambiguous.ID, 10): {
		strconv.FormatInt(r.single.Alternatives[0].ID, 10), strconv.FormatInt(r.single.Alternatives[1].ID, 10),
	}}
	if rec := f.do(http.MethodPost, path, f.handler.ResolveCopy, twoAlts, f.reviewValues(r, 2)...); rec.Code != http.StatusUnprocessableEntity ||
		!strings.Contains(rec.Body.String(), "exactamente una alternativa") {
		t.Errorf("two alternatives on a single: status %d", rec.Code)
	}

	form := url.Values{
		"choice_" + strconv.FormatInt(ambiguous.ID, 10):  {strconv.FormatInt(r.single.Alternatives[1].ID, 10)},
		"comment_" + strconv.FormatInt(ambiguous.ID, 10): {"  borró la primera  "},
		"choice_" + strconv.FormatInt(doubtful.ID, 10):   {"discard"},
	}
	rec := f.do(http.MethodPost, path, f.handler.ResolveCopy, form, f.reviewValues(r, 2)...)
	if loc := rec.Header().Get("Location"); loc != handler.SurveyRunReviewCopyPathFor(r.s.ID, r.run.ID, 3) {
		t.Fatalf("after copy 2: status %d, location %q, want copy 3", rec.Code, loc)
	}
	two, _ = f.surveys.CopyReading(ctx, r.run.ID, 2)
	if len(two.Marks) != 1 || two.Marks[0].AlternativeID != r.single.Alternatives[1].ID {
		t.Errorf("copy 2's marks = %+v, want the chosen one only", two.Marks)
	}
	if two.Items[0].Comment != "borró la primera" || two.Items[1].Resolution != survey.ResolutionDiscarded {
		t.Errorf("copy 2's items = %+v", two.Items)
	}

	three, _ := f.surveys.CopyReading(ctx, r.run.ID, 3)
	last := url.Values{"choice_" + strconv.FormatInt(three.Items[0].ID, 10): {strconv.FormatInt(r.contextQ.Alternatives[1].ID, 10)}}
	rec = f.do(http.MethodPost, handler.SurveyRunReviewCopyPathFor(r.s.ID, r.run.ID, 3), f.handler.ResolveCopy, last, f.reviewValues(r, 3)...)
	if rec.Header().Get("Location") != handler.SurveyRunPathFor(r.s.ID, r.run.ID) || !strings.Contains(flashOf(t, rec), "Revisión completa") {
		t.Errorf("after the last copy: location %q, flash %q", rec.Header().Get("Location"), flashOf(t, rec))
	}
	if counts, _ := f.surveys.ReadingCounts(ctx, r.run.ID); counts.PendingItems != 0 {
		t.Errorf("counts = %+v after every item was decided", counts)
	}
}

// "Saltar": a copy posted with no decision stays in the queue.
func TestAnUndecidedItemStaysPending(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.reviewable()
	f.do(http.MethodPost, handler.SurveyRunReviewCopyPathFor(r.s.ID, r.run.ID, 2), f.handler.ResolveCopy, url.Values{}, f.reviewValues(r, 2)...)
	if counts, _ := f.surveys.ReadingCounts(context.Background(), r.run.ID); counts.PendingItems != 3 {
		t.Errorf("pending items = %d, want all 3", counts.PendingItems)
	}
}

func TestAScannedPageIsServedOnlyForACopyTheRunRead(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.reviewable()
	scans := filepath.Join(f.worker.WorkDir, survey.RunProject(r.s.ID, r.run.ID), "scans")
	if err := os.MkdirAll(scans, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(scans, "copy-2-page-2.jpg"), []byte("jpeg"), 0o644); err != nil {
		t.Fatal(err)
	}
	page := func(copyNumber, n int) *httptest.ResponseRecorder {
		return f.do(http.MethodGet, handler.SurveyRunPagePathFor(r.s.ID, r.run.ID, copyNumber, n), f.handler.RunPage, nil,
			append(f.reviewValues(r, copyNumber), "n", strconv.Itoa(n))...)
	}
	if rec := page(2, 2); rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/jpeg" || rec.Body.String() != "jpeg" {
		t.Errorf("copy 2 page 2: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if rec := page(2, 1); rec.Code != http.StatusNotFound {
		t.Errorf("a page with no image: %d, want 404", rec.Code)
	}
	if rec := page(9, 2); rec.Code != http.StatusNotFound {
		t.Errorf("a copy the run never read: %d, want 404", rec.Code)
	}
}

// Issue #311 S6, AC 7b: a run with scans is not cancelled — an upload is
// enough, a batch whose reading failed included.
func TestARunWithScansIsNotCancelled(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	f.upload(r, "hojas.pdf", "application/pdf", []byte("%PDF-1.4"))
	f.worker.SurveyAnalyzeErr = survey.ErrAnalyzerRefused
	var failure *jobs.Failure
	if err := f.analyse(r, "batch-1.pdf"); !errors.As(err, &failure) {
		t.Fatalf("the reading should have failed: %v", err)
	}
	f.finishLatestJob(r)

	page := f.do(http.MethodGet, handler.SurveyRunPathFor(r.s.ID, r.run.ID), f.handler.RunDetail, nil, f.runValues(r.s, r.run)...).Body.String()
	if strings.Contains(page, "Cancelar pasada") {
		t.Error("the dashboard offers to cancel a run with an uploaded batch")
	}
	rec := f.do(http.MethodPost, handler.SurveyRunCancelPathFor(r.s.ID, r.run.ID), f.handler.CancelRun, url.Values{}, f.runValues(r.s, r.run)...)
	if !strings.Contains(flashOf(t, rec), "Borrar escaneos") {
		t.Errorf("cancelling a run with scans: flash %q, want it to point at Borrar escaneos", flashOf(t, rec))
	}
	if got, _ := f.surveys.Run(context.Background(), r.s.ID, r.run.ID); got.State != survey.RunOpen {
		t.Errorf("the run was cancelled with its scans: %s", got.State)
	}
}

// finishLatestJob marks the run's latest job done, the way the runner
// would once its handler returned.
func (f *surveyFixture) finishLatestJob(r readableRun) {
	f.t.Helper()
	ctx := context.Background()
	job, err := f.jobs.LatestForSubject(ctx, jobs.SubjectSurveyRun, strconv.FormatInt(r.run.ID, 10))
	if err != nil {
		f.t.Fatal(err)
	}
	if err := f.jobs.MarkRunning(ctx, job.ID, f.now); err != nil {
		f.t.Fatal(err)
	}
	if err := f.jobs.MarkDone(ctx, job.ID, "", f.now); err != nil {
		f.t.Fatal(err)
	}
}

func TestBorrarEscaneosErasesWorkerFirstThenTheCopies(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	confirm := handler.SurveyRunScansResetConfirmPathFor(r.s.ID, r.run.ID)
	reset := handler.SurveyRunScansResetPathFor(r.s.ID, r.run.ID)
	values := f.runValues(r.s, r.run)

	if rec := f.do(http.MethodGet, confirm, f.handler.ScansResetConfirm, nil, values...); rec.Code != http.StatusNotFound {
		t.Errorf("confirming a reset of nothing: %d, want 404", rec.Code)
	}

	f.upload(r, "hojas.pdf", "application/pdf", []byte("%PDF-1.4"))
	f.worker.SurveyReports = []survey.Report{{Batch: &survey.Batch{Captured: 1}, Copies: []survey.ReportCopy{
		{CopyNumber: 1, Pages: []int{1}, Answers: []survey.ReportAnswer{answer(r.single, survey.AnswerOK, []int{1})}},
	}}}
	var notice *jobs.Notice
	if err := f.analyse(r, "batch-1.pdf"); !errors.As(err, &notice) {
		t.Fatalf("analysing: %v", err)
	}

	// In flight: refused, fail closed.
	if rec := f.do(http.MethodPost, reset, f.handler.ScansReset, url.Values{"confirm_name": {"Pasada 1"}}, values...); rec.Code != http.StatusConflict {
		t.Errorf("a reset under the queued reading: %d, want 409", rec.Code)
	}
	f.finishLatestJob(r)

	body := f.do(http.MethodGet, confirm, f.handler.ScansResetConfirm, nil, values...).Body.String()
	for _, want := range []string{"1 lote subido", "1 copia leída", "<code>Pasada 1</code>", "NO SE PUEDE DESHACER"} {
		if !strings.Contains(body, want) {
			t.Errorf("the confirmation lacks %q", want)
		}
	}
	if rec := f.do(http.MethodPost, reset, f.handler.ScansReset, url.Values{"confirm_name": {"pasada 1"}}, values...); rec.Code != http.StatusUnprocessableEntity ||
		!strings.Contains(rec.Body.String(), `value="pasada 1"`) {
		t.Errorf("a wrong phrase: %d, want 422 with what was typed", rec.Code)
	}

	// A busy worker: nothing destroyed.
	f.worker.SurveyResetErr = survey.ErrAnalyzerBusy
	if rec := f.do(http.MethodPost, reset, f.handler.ScansReset, url.Values{"confirm_name": {"Pasada 1"}}, values...); rec.Code != http.StatusConflict {
		t.Errorf("a busy worker: %d, want 409", rec.Code)
	}
	if counts, _ := f.surveys.ReadingCounts(context.Background(), r.run.ID); counts.Copies != 1 {
		t.Errorf("the copies went although the worker refused: %+v", counts)
	}

	f.worker.SurveyResetErr = nil
	rec := f.do(http.MethodPost, reset, f.handler.ScansReset, url.Values{"confirm_name": {"Pasada 1"}}, values...)
	if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != handler.SurveyRunScansPathFor(r.s.ID, r.run.ID) {
		t.Fatalf("the reset: %d → %q", rec.Code, rec.Header().Get("Location"))
	}
	if got := f.worker.SurveyResets; len(got) != 2 || got[1] != survey.RunProject(r.s.ID, r.run.ID) {
		t.Errorf("the worker was asked to reset %v", got)
	}
	if counts, _ := f.surveys.ReadingCounts(context.Background(), r.run.ID); counts.Copies != 0 {
		t.Errorf("copies left after the reset: %+v", counts)
	}
	// Starting over: the next upload is batch-1, and the run can be cancelled.
	if rec := f.upload(r, "hojas.pdf", "application/pdf", []byte("%PDF-1.4")); !strings.Contains(flashOf(t, rec), "batch-1.pdf") {
		t.Errorf("the first upload after a reset: %q", flashOf(t, rec))
	}
}

// Issue #311 S7: screen 9's counts and actions follow the reading, and a
// run closes once everything is reviewed — then refuses every mutation.
func TestARunClosesOnceReviewedAndThenRefusesEveryChange(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.reviewable()
	ctx := context.Background()
	values := f.runValues(r.s, r.run)
	dashboard := func() string {
		return f.do(http.MethodGet, handler.SurveyRunPathFor(r.s.ID, r.run.ID), f.handler.RunDetail, nil, values...).Body.String()
	}

	page := dashboard()
	for _, want := range []string{
		"<th>Leídas</th><td>3</td>", "<th>Lectura limpia</th><td>1</td>", "<th>Por revisar</th><td>2</td>",
		"<th>Faltantes</th><td>37</td>", handler.SurveyRunReviewPathFor(r.s.ID, r.run.ID),
		"se habilita al terminar la revisión", "2 copia(s) por revisar",
	} {
		if !strings.Contains(page, want) {
			t.Errorf("the dashboard lacks %q", want)
		}
	}
	closePath := handler.SurveyRunClosePathFor(r.s.ID, r.run.ID)
	if rec := f.do(http.MethodPost, closePath, f.handler.CloseRun, url.Values{}, values...); !strings.Contains(flashOf(t, rec), "Quedan lecturas por revisar") {
		t.Errorf("closing with pending items: flash %q", flashOf(t, rec))
	}

	for _, n := range []int{2, 3} {
		view, _ := f.surveys.CopyReading(ctx, r.run.ID, n)
		form := url.Values{}
		for _, it := range view.Items {
			form.Set("choice_"+strconv.FormatInt(it.ID, 10), "discard")
		}
		f.do(http.MethodPost, handler.SurveyRunReviewCopyPathFor(r.s.ID, r.run.ID, n), f.handler.ResolveCopy, form, f.reviewValues(r, n)...)
	}
	if page := dashboard(); !strings.Contains(page, "Cerrar pasada</button>") {
		t.Fatal("the dashboard does not offer Cerrar pasada once everything is reviewed")
	}
	rec := f.do(http.MethodPost, closePath, f.handler.CloseRun, url.Values{}, values...)
	if !strings.Contains(flashOf(t, rec), "cerrada") {
		t.Fatalf("closing: flash %q", flashOf(t, rec))
	}
	if got, _ := f.surveys.Run(ctx, r.s.ID, r.run.ID); got.State != survey.RunClosed {
		t.Fatalf("state = %s, want closed", got.State)
	}

	page = dashboard()
	if strings.Contains(page, "Cerrar pasada") || strings.Contains(page, "Subir escaneos") || strings.Contains(page, "Cancelar pasada") ||
		!strings.Contains(page, "Ver escaneos") {
		t.Errorf("a closed run's dashboard still offers a change")
	}
	if rec := f.upload(r, "hojas.pdf", "application/pdf", []byte("%PDF")); !strings.Contains(flashOf(t, rec), "ya no está abierta") {
		t.Errorf("uploading to a closed run: %q", flashOf(t, rec))
	}
	if rec := f.do(http.MethodGet, handler.SurveyRunScansResetConfirmPathFor(r.s.ID, r.run.ID), f.handler.ScansResetConfirm, nil, values...); rec.Code != http.StatusNotFound {
		t.Errorf("Borrar escaneos on a closed run: %d, want 404", rec.Code)
	}
	if rec := f.do(http.MethodPost, handler.SurveyRunCancelPathFor(r.s.ID, r.run.ID), f.handler.CancelRun, url.Values{}, values...); !strings.Contains(flashOf(t, rec), "ya no se puede cancelar") {
		t.Errorf("cancelling a closed run: %q", flashOf(t, rec))
	}
	if rec := f.do(http.MethodPost, closePath, f.handler.CloseRun, url.Values{}, values...); !strings.Contains(flashOf(t, rec), "ya no está abierta") {
		t.Errorf("closing twice: %q", flashOf(t, rec))
	}
}

func TestARunWithNothingReadDoesNotClose(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	rec := f.do(http.MethodPost, handler.SurveyRunClosePathFor(r.s.ID, r.run.ID), f.handler.CloseRun, url.Values{}, f.runValues(r.s, r.run)...)
	if !strings.Contains(flashOf(t, rec), "no tiene copias leídas") {
		t.Errorf("closing an unread run: flash %q", flashOf(t, rec))
	}
}
