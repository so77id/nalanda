package handler_test

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
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

func TestScreenThirteenComparesTheClosedRuns(t *testing.T) {
	f := newSurveyFixture(t)
	r, first := f.resultsSurvey()
	ok := survey.AnswerOK
	second := f.closedRunOf(r,
		[]survey.ReportAnswer{answer(r.contextQ, ok, []int{1}), answer(r.single, ok, []int{2}), answer(r.scale, ok, []int{5})},
		[]survey.ReportAnswer{answer(r.contextQ, ok, []int{2}), answer(r.single, ok, []int{2}), answer(r.scale, ok, []int{4})},
	)
	page := handler.SurveyComparePathFor(r.s.ID)
	body := f.do(http.MethodGet, page, f.handler.Compare, nil, f.surveyValue(r.s)...).Body.String()
	for _, want := range []string{
		"2 pasadas cerradas · 3 preguntas", "<th scope=\"col\">P1</th>", "<th scope=\"col\">P2</th>",
		"¿Sección? (contexto)",
		// Scale: mean 3.67 → 4.50, Δ +0.83.
		"<td>3.67</td>", "<td>4.50</td>", "↑ &#43;0.83",
		// Single: reference = most marked in the latest run (rápido, 100 %);
		// run 1 had 1 of 3 answered = 33 %. Δ +67 pp.
		"¿Ritmo? · % rápido", "<td>33 %</td>", "<td>100 %</td>", "↑ &#43;67 pp",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("screen 13 lacks %q", want)
		}
	}
	median := f.do(http.MethodGet, page+"?metric=median", f.handler.Compare, nil, f.surveyValue(r.s)...).Body.String()
	if !strings.Contains(median, "<strong>Mediana</strong>") || !strings.Contains(median, "<td>4</td><td>4.50</td>") {
		t.Errorf("the median metric is not applied:\n%s", median[strings.Index(median, "<nav"):])
	}
	if table := body[strings.Index(body, "<table"):]; strings.Contains(table, "style=") || strings.Contains(table, "class=\"up") {
		t.Error("Δ carries a colour")
	}

	// Entry points: screen 3 and the closed run's dashboard.
	detail := f.do(http.MethodGet, handler.SurveyPathFor(r.s.ID), f.handler.Detail, nil, f.surveyValue(r.s)...).Body.String()
	if !strings.Contains(detail, handler.SurveyRunResultsPathFor(r.s.ID, second.ID)) || !strings.Contains(detail, page) {
		t.Error("screen 3 does not link the results and the comparison")
	}
	dash := f.do(http.MethodGet, handler.SurveyRunPathFor(r.s.ID, first.ID), f.handler.RunDetail, nil, f.runValues(r.s, first)...).Body.String()
	if !strings.Contains(dash, "Ver resultados") {
		t.Error("a closed run's dashboard does not offer its results")
	}
}

// readCSV reads an export the way pandas would: BOM, then RFC 4180.
func readCSV(t *testing.T, rec *httptest.ResponseRecorder, file string) [][]string {
	t.Helper()
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "text/csv; charset=utf-8" ||
		!strings.Contains(rec.Header().Get("Content-Disposition"), `filename="`+file+`"`) {
		t.Fatalf("export %s: %d %v", file, rec.Code, rec.Header())
	}
	body := rec.Body.String()
	if !strings.HasPrefix(body, "\ufeff") {
		t.Errorf("%s has no BOM", file)
	}
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(body, "\ufeff"))).ReadAll()
	if err != nil {
		t.Fatalf("%s does not parse: %v", file, err)
	}
	return rows
}

func TestTheThreeExports(t *testing.T) {
	f := newSurveyFixture(t)
	r, run := f.resultsSurvey()

	bank := readCSV(t, f.do(http.MethodGet, handler.SurveyBankCSVPathFor(r.s.ID), f.handler.BankCSV, nil, f.surveyValue(r.s)...),
		fmt.Sprintf("encuesta-%d-banco.csv", r.s.ID))
	if len(bank) != 1+2+5+2 || bank[0][0] != "Pregunta" || bank[1][4] != "¿Ritmo?" || bank[1][8] != "lento" {
		t.Errorf("bank export = %v", bank)
	}

	raw := readCSV(t, f.do(http.MethodGet, handler.SurveyRunCSVPathFor(r.s.ID, run.ID), f.handler.RunCSV, nil, f.runValues(r.s, run)...),
		fmt.Sprintf("encuesta-%d-pasada-1.csv", r.s.ID))
	want := [][]string{
		{"Copia", "P1 · ¿Sección?", "P2 · ¿Ritmo?", "P3 · ¿Clara?"},
		{"1", "A", "lento", "4"}, {"2", "A", "rápido", "5"}, {"3", "B", "lento", "2"}, {"4", "B", "", ""},
	}
	if fmt.Sprint(raw) != fmt.Sprint(want) {
		t.Errorf("raw export =\n%v\nwant\n%v", raw, want)
	}

	cmp := readCSV(t, f.do(http.MethodGet, handler.SurveyCompareCSVPathFor(r.s.ID), f.handler.CompareCSV, nil, f.surveyValue(r.s)...),
		fmt.Sprintf("encuesta-%d-comparacion.csv", r.s.ID))
	if len(cmp) != 4 || fmt.Sprint(cmp[0]) != "[Pregunta P1 Δ]" || cmp[2][1] != "3.67" {
		t.Errorf("comparison export = %v", cmp)
	}
}

// The raw export numbers its rows; AMC's copy numbers stay inside.
func TestTheRawExportCarriesNoCopyNumber(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	single, _, _ := f.bankOfThree(s)
	run := f.createRunThroughTheForm(s, "")
	f.finishGeneration(s, run)
	f.worker.SurveyReports = []survey.Report{{Batch: survey.Batch{Captured: 2}, Copies: []survey.ReportCopy{
		{CopyNumber: 17, Answers: []survey.ReportAnswer{answer(single, survey.AnswerOK, []int{1})}},
		{CopyNumber: 23, Answers: []survey.ReportAnswer{answer(single, survey.AnswerOK, []int{2})}},
	}}}
	var notice *jobs.Notice
	if err := survey.NewAnalyseHandler(f.surveys)(context.Background(), strconv.FormatInt(run.ID, 10),
		survey.EncodeAnalysePayload(s.ID, "batch-1.pdf")); !errors.As(err, &notice) {
		t.Fatal(err)
	}
	if err := f.surveys.CloseRun(context.Background(), s.ID, run.ID); err != nil {
		t.Fatal(err)
	}
	rec := f.do(http.MethodGet, handler.SurveyRunCSVPathFor(s.ID, run.ID), f.handler.RunCSV, nil, f.runValues(s, run)...)
	if body := rec.Body.String(); strings.Contains(body, "17") || strings.Contains(body, "23") {
		t.Errorf("the raw export leaks AMC copy numbers:\n%s", body)
	}
}

// A statement a spreadsheet would run as a formula is exported inert.
func TestAFormulaLikeStatementIsExportedInert(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "=HYPERLINK(\"http://x\")", Labels: []string{"@a", "b"}})
	rows := readCSV(t, f.do(http.MethodGet, handler.SurveyBankCSVPathFor(s.ID), f.handler.BankCSV, nil, f.surveyValue(s)...),
		fmt.Sprintf("encuesta-%d-banco.csv", s.ID))
	if rows[1][4] != `'=HYPERLINK("http://x")` || rows[1][8] != "'@a" {
		t.Errorf("formula-like text = %q / %q", rows[1][4], rows[1][8])
	}
}
