package handler_test

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// Issue #312: the results of closed runs (screens 7, 6, 13 and the CSVs).

// closedRunOf reads a batch into a fresh run of r's survey and closes it.
// marks are, per copy, (question, 1-based alternative position) pairs; the
// context question goes as r.contextQ.
func (f *surveyFixture) closedRunOf(r readableRun, answers ...[]survey.ReportAnswer) survey.Run {
	f.t.Helper()
	run := f.createRunThroughTheForm(r.s, "")
	f.finishGeneration(r.s, run)
	report := survey.Report{Batch: survey.Batch{Captured: len(answers)}}
	for i, a := range answers {
		report.Copies = append(report.Copies, survey.ReportCopy{CopyNumber: i + 1, Pages: []int{1}, Answers: a})
	}
	f.worker.SurveyReports = []survey.Report{report}
	var notice *jobs.Notice
	if err := survey.NewAnalyseHandler(f.surveys)(context.Background(), strconv.FormatInt(run.ID, 10),
		survey.EncodeAnalysePayload(r.s.ID, "batch-1.pdf")); !errors.As(err, &notice) {
		f.t.Fatalf("analysing: %v", err)
	}
	if err := f.surveys.CloseRun(context.Background(), r.s.ID, run.ID); err != nil {
		f.t.Fatalf("closing: %v", err)
	}
	got, _ := f.surveys.Run(context.Background(), r.s.ID, run.ID)
	return got
}

// resultsSurvey is a survey (single "¿Ritmo?" lento/rápido, scale "¿Clara?"
// 1–5, context "¿Sección?" A/B) with one closed run of four copies:
//
//	copy 1: A, lento, 4      copy 3: B, lento, 2
//	copy 2: A, rápido, 5     copy 4: B, —,     —
func (f *surveyFixture) resultsSurvey() (readableRun, survey.Run) {
	f.t.Helper()
	s := f.createSurvey("Banco")
	single, scale, contextQ := f.bankOfThree(s)
	r := readableRun{s: s, single: single, scale: scale, contextQ: contextQ}
	ok := survey.AnswerOK
	run := f.closedRunOf(r,
		[]survey.ReportAnswer{answer(contextQ, ok, []int{1}), answer(single, ok, []int{1}), answer(scale, ok, []int{4})},
		[]survey.ReportAnswer{answer(contextQ, ok, []int{1}), answer(single, ok, []int{2}), answer(scale, ok, []int{5})},
		[]survey.ReportAnswer{answer(contextQ, ok, []int{2}), answer(single, ok, []int{1}), answer(scale, ok, []int{2})},
		[]survey.ReportAnswer{answer(contextQ, ok, []int{2})},
	)
	r.run = run
	return r, run
}

func TestScreenSevenShowsEveryQuestionOfAClosedRun(t *testing.T) {
	f := newSurveyFixture(t)
	r, run := f.resultsSurvey()
	page := handler.SurveyRunResultsPathFor(r.s.ID, run.ID)
	body := f.do(http.MethodGet, page, f.handler.RunResults, nil, f.runValues(r.s, run)...).Body.String()
	for _, want := range []string{
		"Resultados · Pasada #1", "4 copias leídas",
		"1 · ¿Sección?",                            // context prints first
		"3 respuestas de 4 copias",                 // the single: one blank
		"Promedio 3.67 · Moda 2, 4, 5 · Mediana 4", // scale 4, 5, 2
		`aria-label="Distribución: lento, 2 respuestas; rápido, 1 respuesta"`,
		"Filtrar por: ¿Sección?",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("screen 7 lacks %q", want)
		}
	}
}

func TestTheContextFilterRecomputesOverItsCopies(t *testing.T) {
	f := newSurveyFixture(t)
	r, run := f.resultsSurvey()
	page := handler.SurveyRunResultsPathFor(r.s.ID, run.ID)
	q := url.Values{"ctx": {strconv.FormatInt(r.contextQ.ID, 10)}, "alt": {strconv.FormatInt(r.contextQ.Alternatives[1].ID, 10)}}
	body := f.do(http.MethodGet, page+"?"+q.Encode(), f.handler.RunResults, nil, f.runValues(r.s, run)...).Body.String()
	for _, want := range []string{"→ 2 copias de 4", "Quitar filtro", "1 respuesta de 2 copias", "Promedio 2 · Moda 2 · Mediana 2"} {
		if !strings.Contains(body, want) {
			t.Errorf("filtered to B lacks %q", want)
		}
	}
	// A filter on a question that is not the run's context is dropped.
	bad := url.Values{"ctx": {strconv.FormatInt(r.single.ID, 10)}}
	if rec := f.do(http.MethodGet, page+"?"+bad.Encode(), f.handler.RunResults, nil, f.runValues(r.s, run)...); rec.Header().Get("Location") != page {
		t.Errorf("a filter on a non-context question: %d → %q", rec.Code, rec.Header().Get("Location"))
	}
}

func TestAnOpenRunHasNoResultsYet(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	rec := f.do(http.MethodGet, handler.SurveyRunResultsPathFor(r.s.ID, r.run.ID), f.handler.RunResults, nil, f.runValues(r.s, r.run)...)
	if rec.Header().Get("Location") != handler.SurveyRunPathFor(r.s.ID, r.run.ID) || !strings.Contains(flashOf(t, rec), "cuando la pasada se cierra") {
		t.Errorf("an open run's results: %d → %q, flash %q", rec.Code, rec.Header().Get("Location"), flashOf(t, rec))
	}
}

func TestScreenSixShowsOneQuestionAndItsClosedRuns(t *testing.T) {
	f := newSurveyFixture(t)
	r, first := f.resultsSurvey()
	ok := survey.AnswerOK
	// A second closed run: the scale reads 5 and 5.
	f.closedRunOf(r,
		[]survey.ReportAnswer{answer(r.contextQ, ok, []int{1}), answer(r.scale, ok, []int{5})},
		[]survey.ReportAnswer{answer(r.contextQ, ok, []int{2}), answer(r.scale, ok, []int{5})},
	)
	page := handler.SurveyRunResultQuestionPathFor(r.s.ID, first.ID, r.scale.ID)
	body := f.do(http.MethodGet, page, f.handler.RunResultQuestion, nil,
		append(f.runValues(r.s, first), "qid", strconv.FormatInt(r.scale.ID, 10))...).Body.String()
	for _, want := range []string{
		"¿Clara?", "Escala 1-5 · 3 respuestas de 4 copias", "Promedio 3.67",
		"Pasada 1", "promedio 3.67 · moda 2, 4, 5 · mediana 4",
		"Pasada 2", "promedio 5 · moda 5 · mediana 5",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("screen 6 lacks %q", want)
		}
	}
	// Screen 7 links each block to it, keeping the filter.
	q := url.Values{"ctx": {strconv.FormatInt(r.contextQ.ID, 10)}, "alt": {strconv.FormatInt(r.contextQ.Alternatives[0].ID, 10)}}
	list := f.do(http.MethodGet, handler.SurveyRunResultsPathFor(r.s.ID, first.ID)+"?"+q.Encode(), f.handler.RunResults, nil, f.runValues(r.s, first)...).Body.String()
	if !strings.Contains(list, page+"?"+strings.ReplaceAll(q.Encode(), "&", "&amp;")) {
		t.Errorf("screen 7's block does not link screen 6 with the filter")
	}
	// A question the run did not print: 404.
	other := f.addQuestion(r.s, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿Nueva?", Labels: []string{"a", "b"}})
	rec := f.do(http.MethodGet, handler.SurveyRunResultQuestionPathFor(r.s.ID, first.ID, other.ID), f.handler.RunResultQuestion, nil,
		append(f.runValues(r.s, first), "qid", strconv.FormatInt(other.ID, 10))...)
	if rec.Code != http.StatusNotFound {
		t.Errorf("a question the run never printed: %d, want 404", rec.Code)
	}
}
