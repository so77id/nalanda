package handler_test

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// Screen 8 and the run's two halves (issue #310 S5), against the real
// store, the real job store and the worker fake.

func (f *surveyFixture) bankOfThree(s survey.Survey) (single, scale, contextQ survey.Question) {
	f.t.Helper()
	single = f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿Ritmo?", Labels: []string{"lento", "rápido"}})
	scale = f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindScale, Statement: "¿Clara?", Labels: survey.DefaultScaleLabels(5)})
	contextQ = f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿Sección?", IsContext: true, Labels: []string{"A", "B"}})
	return single, scale, contextQ
}

func TestTheNewRunFormStartsAtTodayWithAClassOfCopies(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	f.bankOfThree(s)

	rec := f.do(http.MethodGet, handler.SurveyRunNewPathFor(s.ID), f.handler.NewRun, nil, f.surveyValue(s)...)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{`value="2026-10-05"`, `value="45"`, "todas las del banco (3)", "ya no se pueden editar"} {
		if !strings.Contains(body, want) {
			t.Errorf("the form lacks %q", want)
		}
	}
}

func TestCreatingARunSnapshotsTheBankWritesItsSourceAndQueuesItsSheet(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Autoevaluación")
	single, scale, contextQ := f.bankOfThree(s)

	rec := f.do(http.MethodPost, handler.SurveyRunsPathFor(s.ID), f.handler.CreateRun,
		url.Values{"name": {"Mitad"}, "applied_on": {"2026-10-15"}, "copies": {"40"}}, f.surveyValue(s)...)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d\n%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(flashOf(t, rec), "Pasada #1 creada") {
		t.Errorf("flash = %q", flashOf(t, rec))
	}

	runs, err := f.surveys.Runs(context.Background(), s.ID)
	if err != nil || len(runs) != 1 {
		t.Fatalf("runs = %+v, %v", runs, err)
	}
	run := runs[0]
	if run.Number != 1 || run.Name != "Mitad" || run.AppliedOn != "2026-10-15" || run.Copies != 40 || run.State != survey.RunOpen {
		t.Errorf("run = %+v", run)
	}

	// The snapshot prints the context question first, then bank order.
	snapshot, err := surveystoreFor(f).RunQuestions(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("RunQuestions: %v", err)
	}
	var order []int64
	for _, q := range snapshot {
		order = append(order, q.QuestionID)
	}
	if len(order) != 3 || order[0] != contextQ.ID || order[1] != single.ID || order[2] != scale.ID {
		t.Errorf("printed order = %v, want context, single, scale", order)
	}

	// The source is on the shared volume, where the worker will look.
	source, err := os.ReadFile(filepath.Join(f.worker.WorkDir, survey.RunProject(s.ID, run.ID), "inputs", "source.tex"))
	if err != nil {
		t.Fatalf("reading the source: %v", err)
	}
	if !strings.Contains(string(source), `\onecopy{40}`) ||
		strings.Index(string(source), "{q"+strconv.FormatInt(contextQ.ID, 10)+"}") > strings.Index(string(source), "{q"+strconv.FormatInt(single.ID, 10)+"}") {
		t.Errorf("the source does not print 40 copies context-first:\n%s", source)
	}

	// The generation is queued on the one runner, about this run.
	job, err := f.jobs.LatestForSubject(context.Background(), jobs.SubjectSurveyRun, strconv.FormatInt(run.ID, 10))
	if err != nil || job.Kind != jobs.KindSurveyGenerate || job.Status != jobs.StatusQueued {
		t.Errorf("queued job = %+v, %v; want a queued survey_generate about the run", job, err)
	}

	// And the bank is locked.
	err = f.surveys.MoveQuestion(context.Background(), s.ID, single.ID, +1)
	if !errors.Is(err, survey.ErrBankLocked) {
		t.Errorf("moving a question after the run: %v, want ErrBankLocked", err)
	}
}

func TestTheGenerateJobAsksTheWorkerForTheRunsSheet(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	f.bankOfThree(s)
	run, err := f.surveys.CreateRun(context.Background(), s.ID, f.professor.ID,
		survey.RunDraft{AppliedOn: "2026-10-15", Copies: 12})
	if err != nil {
		t.Fatalf("CreateRun: %v", err)
	}

	generate := survey.NewGenerateHandler(f.surveys)
	if err := generate(context.Background(), strconv.FormatInt(run.ID, 10), survey.EncodeRunPayload(s.ID)); err != nil {
		t.Fatalf("the job: %v", err)
	}
	if f.worker.SheetCallCount() != 1 {
		t.Fatalf("the worker was asked %d times, want once", f.worker.SheetCallCount())
	}
	call := f.worker.SheetCalls[0]
	project := survey.RunProject(s.ID, run.ID)
	if call.Project != project || call.Source != filepath.Join(project, "inputs", "source.tex") || call.Copies != 12 {
		t.Errorf("worker call = %+v", call)
	}
	if _, err := os.Stat(f.surveys.SheetPath(run)); err != nil {
		t.Errorf("no sheet where SheetPath says: %v", err)
	}

	// A refusal is a Spanish banner message, with the worker's words kept
	// for debugging only.
	f.worker.SheetErr = survey.ErrGeneratorRefused
	err = generate(context.Background(), strconv.FormatInt(run.ID, 10), survey.EncodeRunPayload(s.ID))
	var failure *jobs.Failure
	if !errors.As(err, &failure) || !strings.Contains(failure.Message, "rechazó") {
		t.Errorf("a refused generation: %v, want a jobs.Failure in Spanish", err)
	}
	// A payload naming another survey finds no such run of it.
	f.worker.SheetErr = nil
	err = generate(context.Background(), strconv.FormatInt(run.ID, 10), survey.EncodeRunPayload(s.ID+99))
	if !errors.As(err, &failure) || !strings.Contains(failure.Message, "ya no existe") {
		t.Errorf("a run under the wrong survey: %v", err)
	}
}

func TestARunIsRefusedWithAnEmptyBankOrBadValues(t *testing.T) {
	f := newSurveyFixture(t)
	empty := f.createSurvey("Vacía")
	rec := f.do(http.MethodPost, handler.SurveyRunsPathFor(empty.ID), f.handler.CreateRun,
		url.Values{"applied_on": {"2026-10-15"}, "copies": {"10"}}, f.surveyValue(empty)...)
	if rec.Code != http.StatusSeeOther || !strings.Contains(flashOf(t, rec), "al menos una pregunta") {
		t.Errorf("an empty bank: status = %d, flash = %q", rec.Code, flashOf(t, rec))
	}

	s := f.createSurvey("Banco")
	f.bankOfThree(s)
	for name, form := range map[string]url.Values{
		"zero copies": {"applied_on": {"2026-10-15"}, "copies": {"0"}},
		"no number":   {"applied_on": {"2026-10-15"}, "copies": {"muchas"}},
		"a bad date":  {"applied_on": {"15/10/2026"}, "copies": {"10"}},
	} {
		rec := f.do(http.MethodPost, handler.SurveyRunsPathFor(s.ID), f.handler.CreateRun, form, f.surveyValue(s)...)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: status = %d, want 422", name, rec.Code)
		}
	}
	for _, sv := range []survey.Survey{empty, s} {
		if runs, _ := f.surveys.Runs(context.Background(), sv.ID); len(runs) != 0 {
			t.Errorf("survey %q got a run from a refused request", sv.Name)
		}
	}
}

// createRunThroughTheForm posts screen 8 and returns the stored run.
func (f *surveyFixture) createRunThroughTheForm(s survey.Survey, name string) survey.Run {
	f.t.Helper()
	rec := f.do(http.MethodPost, handler.SurveyRunsPathFor(s.ID), f.handler.CreateRun,
		url.Values{"name": {name}, "applied_on": {"2026-10-15"}, "copies": {"40"}}, f.surveyValue(s)...)
	if rec.Code != http.StatusSeeOther {
		f.t.Fatalf("creating the run: status = %d", rec.Code)
	}
	runs, err := f.surveys.Runs(context.Background(), s.ID)
	if err != nil || len(runs) == 0 {
		f.t.Fatalf("runs = %+v, %v", runs, err)
	}
	if loc := rec.Header().Get("Location"); loc != handler.SurveyRunPathFor(s.ID, runs[0].ID) {
		f.t.Errorf("creating a run landed on %q, want its dashboard", loc)
	}
	return runs[0]
}

// finishGeneration runs the queued survey_generate job by hand and records
// it done, the way the runner would.
func (f *surveyFixture) finishGeneration(s survey.Survey, run survey.Run) {
	f.t.Helper()
	ctx := context.Background()
	job, err := f.jobs.LatestByKind(ctx, strconv.FormatInt(run.ID, 10), jobs.KindSurveyGenerate)
	if err != nil {
		f.t.Fatalf("the queued generation: %v", err)
	}
	if err := survey.NewGenerateHandler(f.surveys)(ctx, job.SubjectID, job.Payload); err != nil {
		f.t.Fatalf("running the generation: %v", err)
	}
	if err := f.jobs.MarkRunning(ctx, job.ID, f.now); err != nil {
		f.t.Fatal(err)
	}
	if err := f.jobs.MarkDone(ctx, job.ID, "", f.now); err != nil {
		f.t.Fatal(err)
	}
}

func (f *surveyFixture) runValues(s survey.Survey, run survey.Run) []string {
	return []string{"id", strconv.FormatInt(s.ID, 10), "rid", strconv.FormatInt(run.ID, 10)}
}

func TestTheRunDashboardFollowsItsSheetFromQueuedToDownloadable(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Autoevaluación")
	f.bankOfThree(s)
	run := f.createRunThroughTheForm(s, "Mitad")
	page := handler.SurveyRunPathFor(s.ID, run.ID)

	body := f.do(http.MethodGet, page, f.handler.RunDetail, nil, f.runValues(s, run)...).Body.String()
	for _, want := range []string{"Pasada #1 · Mitad", "Procesando generación del PDF", "(todavía se está generando)", "3 preguntas"} {
		if !strings.Contains(body, want) {
			t.Errorf("the queued dashboard lacks %q", want)
		}
	}
	// Not while the job is in flight: cancelling under a running generation
	// is the race the fourth synchronous rule forbids.
	if strings.Contains(body, "Cancelar pasada") {
		t.Error("the dashboard offers Cancelar while the generation is in flight")
	}
	if rec := f.do(http.MethodGet, page+"/sujet.pdf", f.handler.RunSheet, nil, f.runValues(s, run)...); rec.Code != http.StatusNotFound {
		t.Errorf("the PDF before its generation: status = %d, want 404", rec.Code)
	}

	f.finishGeneration(s, run)
	body = f.do(http.MethodGet, page, f.handler.RunDetail, nil, f.runValues(s, run)...).Body.String()
	if !strings.Contains(body, handler.SurveyRunSheetPathFor(s.ID, run.ID)) || !strings.Contains(body, "Cancelar pasada") {
		t.Errorf("the generated dashboard lacks the download or the cancel")
	}
	rec := f.do(http.MethodGet, page+"/sujet.pdf", f.handler.RunSheet, nil, f.runValues(s, run)...)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/pdf" ||
		!strings.Contains(rec.Header().Get("Content-Disposition"), "pasada-1.pdf") {
		t.Errorf("the download: status = %d, headers = %v", rec.Code, rec.Header())
	}
}

func TestCancellingARunReleasesTheBank(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	single, _, _ := f.bankOfThree(s)
	run := f.createRunThroughTheForm(s, "")
	cancel := handler.SurveyRunCancelPathFor(s.ID, run.ID)

	rec := f.do(http.MethodPost, cancel, f.handler.CancelRun, url.Values{}, f.runValues(s, run)...)
	if !strings.Contains(flashOf(t, rec), "generación del PDF en curso") {
		t.Errorf("cancelling under a queued generation: flash = %q", flashOf(t, rec))
	}
	if got, _ := f.surveys.Run(context.Background(), s.ID, run.ID); got.State != survey.RunOpen {
		t.Fatalf("the run was cancelled under its generation: %s", got.State)
	}

	f.finishGeneration(s, run)
	rec = f.do(http.MethodPost, cancel, f.handler.CancelRun, url.Values{}, f.runValues(s, run)...)
	if rec.Code != http.StatusSeeOther || !strings.Contains(flashOf(t, rec), "cancelada") {
		t.Fatalf("cancel: status = %d, flash = %q", rec.Code, flashOf(t, rec))
	}
	if err := f.surveys.MoveQuestion(context.Background(), s.ID, single.ID, +1); err != nil {
		t.Errorf("the bank after the only run was cancelled: %v, want it unlocked", err)
	}
	rec = f.do(http.MethodPost, cancel, f.handler.CancelRun, url.Values{}, f.runValues(s, run)...)
	if !strings.Contains(flashOf(t, rec), "ya no se puede cancelar") {
		t.Errorf("cancelling twice: flash = %q", flashOf(t, rec))
	}
}

func TestEditingARunChangesItsNameAndDateOnly(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	f.bankOfThree(s)
	run := f.createRunThroughTheForm(s, "Antes")
	edit := handler.SurveyRunEditPathFor(s.ID, run.ID)

	body := f.do(http.MethodGet, edit, f.handler.EditRun, nil, f.runValues(s, run)...).Body.String()
	if !strings.Contains(body, `value="Antes"`) || strings.Contains(body, `name="copies"`) {
		t.Error("the edit form is not pre-filled, or offers the copies")
	}
	rec := f.do(http.MethodPost, edit, f.handler.UpdateRun,
		url.Values{"name": {"Final"}, "applied_on": {"2026-12-01"}, "copies": {"999"}}, f.runValues(s, run)...)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d", rec.Code)
	}
	got, _ := f.surveys.Run(context.Background(), s.ID, run.ID)
	if got.Name != "Final" || got.AppliedOn != "2026-12-01" || got.Copies != 40 {
		t.Errorf("after edit: %+v (copies must stay 40)", got)
	}
	rec = f.do(http.MethodPost, edit, f.handler.UpdateRun, url.Values{"applied_on": {"mañana"}}, f.runValues(s, run)...)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("a bad date: status = %d, want 422", rec.Code)
	}
}

func TestARunOfAnotherSurveyIs404(t *testing.T) {
	f := newSurveyFixture(t)
	mine := f.createSurvey("Mía")
	other := f.createSurvey("Otra")
	f.bankOfThree(other)
	theirs := f.createRunThroughTheForm(other, "")
	values := []string{"id", strconv.FormatInt(mine.ID, 10), "rid", strconv.FormatInt(theirs.ID, 10)}
	for name, h := range map[string]http.HandlerFunc{"detail": f.handler.RunDetail, "sheet": f.handler.RunSheet, "edit": f.handler.EditRun} {
		if rec := f.do(http.MethodGet, "/surveys/x/runs/y", h, nil, values...); rec.Code != http.StatusNotFound {
			t.Errorf("%s through the wrong survey: status = %d, want 404", name, rec.Code)
		}
	}
}

func TestTheSurveyPageListsItsRunsAndLocksItsBank(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Autoevaluación")
	f.bankOfThree(s)
	before := f.do(http.MethodGet, handler.SurveyPathFor(s.ID), f.handler.Detail, nil, f.surveyValue(s)...).Body.String()
	if !strings.Contains(before, "Ninguna pasada aún.") || !strings.Contains(before, `aria-label="Borrar la pregunta 1"`) {
		t.Fatal("before any run the bank should be editable and the runs card empty")
	}

	run := f.createRunThroughTheForm(s, "Mitad")
	after := f.do(http.MethodGet, handler.SurveyPathFor(s.ID), f.handler.Detail, nil, f.surveyValue(s)...).Body.String()
	for _, want := range []string{"Pasada #1 · Mitad", handler.SurveyRunPathFor(s.ID, run.ID), "2026-10-15 · 40 copias · abierta", "ya tiene una pasada", "Previsualizar"} {
		if !strings.Contains(after, want) {
			t.Errorf("the locked survey page lacks %q", want)
		}
	}
	for _, gone := range []string{`aria-label="Borrar la pregunta`, `aria-label="Subir la pregunta`} {
		if strings.Contains(after, gone) {
			t.Errorf("the locked bank still offers %s", gone)
		}
	}

	list := f.do(http.MethodGet, handler.CourseSurveysPathFor(f.courseID), f.handler.ListForCourse, nil, f.courseValue()...).Body.String()
	if !strings.Contains(list, "3 preguntas · 1 pasada · última: 2026-10-15") {
		t.Errorf("the course list does not count the run:\n%s", list)
	}
}

// #310 review, COR-1 end to end: cancel a run, then delete a question it
// printed, through the handlers — a flash and a smaller bank, never a 500.
func TestDeletingAQuestionAfterCancellingItsRunWorks(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	single, _, _ := f.bankOfThree(s)
	run := f.createRunThroughTheForm(s, "")
	f.finishGeneration(s, run)
	f.do(http.MethodPost, handler.SurveyRunCancelPathFor(s.ID, run.ID), f.handler.CancelRun, url.Values{}, f.runValues(s, run)...)

	rec := f.do(http.MethodPost, questionBase(s, single)+"/delete", f.handler.DeleteQuestion, url.Values{}, f.questionValues(s, single)...)
	if rec.Code != http.StatusSeeOther || !strings.Contains(flashOf(t, rec), "borrada") {
		t.Errorf("delete after cancel: status = %d, flash = %q", rec.Code, flashOf(t, rec))
	}
	if n := len(f.bank(s)); n != 2 {
		t.Errorf("bank has %d questions, want 2", n)
	}
}

// #310 review, COR-3: when the source cannot be written the run is
// cancelled, so a sheet that never existed does not lock the bank.
func TestARunWhoseSourceCannotBeWrittenIsCancelled(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	single, _, _ := f.bankOfThree(s)
	// The run directory's parent is a FILE: MkdirAll cannot make the run's.
	blocker := filepath.Join(f.worker.WorkDir, "surveys", strconv.FormatInt(s.ID, 10))
	if err := os.MkdirAll(filepath.Dir(blocker), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(blocker, []byte("no soy un directorio"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := f.surveys.CreateRun(context.Background(), s.ID, f.professor.ID, survey.RunDraft{AppliedOn: "2026-10-15", Copies: 5})
	if err == nil {
		t.Fatal("CreateRun succeeded with an unwritable source")
	}
	runs, _ := f.surveys.Runs(context.Background(), s.ID)
	if len(runs) != 1 || runs[0].State != survey.RunCancelled {
		t.Fatalf("runs = %+v, want one cancelled run", runs)
	}
	if err := f.surveys.MoveQuestion(context.Background(), s.ID, single.ID, +1); err != nil {
		t.Errorf("the bank after a failed run: %v, want it unlocked", err)
	}
}

// #310 review, COR-4: a failed generation says so on the PDF step.
func TestAFailedGenerationIsNamedOnTheDashboard(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	f.bankOfThree(s)
	run := f.createRunThroughTheForm(s, "")
	ctx := context.Background()
	job, err := f.jobs.LatestByKind(ctx, strconv.FormatInt(run.ID, 10), jobs.KindSurveyGenerate)
	if err != nil {
		t.Fatal(err)
	}
	_ = f.jobs.MarkRunning(ctx, job.ID, f.now)
	_ = f.jobs.MarkFailed(ctx, job.ID, "El generador rechazó la hoja de la encuesta.", "debug", f.now)

	body := f.do(http.MethodGet, handler.SurveyRunPathFor(s.ID, run.ID), f.handler.RunDetail, nil, f.runValues(s, run)...).Body.String()
	for _, want := range []string{"PDF<span class=\"survey-meta\"> · falló", "Falló la generación del PDF:", "El generador rechazó"} {
		if !strings.Contains(body, want) {
			t.Errorf("the failed dashboard lacks %q", want)
		}
	}
	if strings.Contains(body, "debug") {
		t.Error("a survey job's debug detail reached the page")
	}
}

// #310 review, COR-7: a hand-typed edit of a cancelled run is a flash.
func TestEditingACancelledRunIsRefusedWithAFlash(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	f.bankOfThree(s)
	run := f.createRunThroughTheForm(s, "Antes")
	f.finishGeneration(s, run)
	f.do(http.MethodPost, handler.SurveyRunCancelPathFor(s.ID, run.ID), f.handler.CancelRun, url.Values{}, f.runValues(s, run)...)

	rec := f.do(http.MethodPost, handler.SurveyRunEditPathFor(s.ID, run.ID), f.handler.UpdateRun,
		url.Values{"name": {"Después"}, "applied_on": {"2026-12-01"}}, f.runValues(s, run)...)
	if rec.Code != http.StatusSeeOther || !strings.Contains(flashOf(t, rec), "ya no está abierta") {
		t.Errorf("status = %d, flash = %q", rec.Code, flashOf(t, rec))
	}
	// Nor is its form drawn: a form whose save is refused is a dead offer.
	rec = f.do(http.MethodGet, handler.SurveyRunEditPathFor(s.ID, run.ID), f.handler.EditRun, nil, f.runValues(s, run)...)
	if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != handler.SurveyRunPathFor(s.ID, run.ID) {
		t.Errorf("GET edit of a cancelled run: status = %d, location = %q", rec.Code, rec.Header().Get("Location"))
	}
}

// #310 review recheck, COR-R1 / COR-R2: a cancelled run's page does not
// claim it printed zero questions, and a run whose generation was never
// queued says so instead of "en curso".
func TestTheDashboardOfACancelledOrNeverQueuedRun(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	f.bankOfThree(s)
	run := f.createRunThroughTheForm(s, "")
	if _, err := f.db.Exec(`DELETE FROM job`); err != nil {
		t.Fatal(err)
	}
	body := f.do(http.MethodGet, handler.SurveyRunPathFor(s.ID, run.ID), f.handler.RunDetail, nil, f.runValues(s, run)...).Body.String()
	if !strings.Contains(body, "PDF<span class=\"survey-meta\"> · no encolado") {
		t.Error("a never-queued generation is not named")
	}

	f.do(http.MethodPost, handler.SurveyRunCancelPathFor(s.ID, run.ID), f.handler.CancelRun, url.Values{}, f.runValues(s, run)...)
	body = f.do(http.MethodGet, handler.SurveyRunPathFor(s.ID, run.ID), f.handler.RunDetail, nil, f.runValues(s, run)...).Body.String()
	if strings.Contains(body, "0 preguntas") || !strings.Contains(body, "cancelada") {
		t.Errorf("the cancelled run's facts are wrong:\n%s", body)
	}
}

// #310 browser check: a cancelled run is printed by nobody and read by
// nobody — its dashboard says so instead of offering the PDF and the next
// steps, and the PDF itself is refused even though it was generated.
func TestACancelledRunOffersNothingToPrint(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	f.bankOfThree(s)
	run := f.createRunThroughTheForm(s, "")
	f.finishGeneration(s, run)
	page := handler.SurveyRunPathFor(s.ID, run.ID)
	f.do(http.MethodPost, handler.SurveyRunCancelPathFor(s.ID, run.ID), f.handler.CancelRun, url.Values{}, f.runValues(s, run)...)

	body := f.do(http.MethodGet, page, f.handler.RunDetail, nil, f.runValues(s, run)...).Body.String()
	if strings.Contains(body, "Descargar PDF") || strings.Contains(body, "Subir escaneos") {
		t.Errorf("a cancelled run still offers its actions:\n%s", body)
	}
	if !strings.Contains(body, "Esta pasada se canceló") {
		t.Errorf("a cancelled run does not say it was cancelled:\n%s", body)
	}
	if rec := f.do(http.MethodGet, page+"/sujet.pdf", f.handler.RunSheet, nil, f.runValues(s, run)...); rec.Code != http.StatusNotFound {
		t.Errorf("a cancelled run's PDF: status = %d, want 404", rec.Code)
	}
}
