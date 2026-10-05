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
