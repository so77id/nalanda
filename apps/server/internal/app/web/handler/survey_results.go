package handler

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// A closed run's results (issue #312, screen 7): every question's block,
// optionally recomputed over the copies that marked a context answer.
// Read-only: every route here is a GET.

// SurveyRunResultsPath is screen 7.
const SurveyRunResultsPath = "/surveys/{id}/runs/{rid}/results"

// SurveyRunResultsPathFor builds screen 7's URL.
func SurveyRunResultsPathFor(surveyID, runID int64) string {
	return SurveyRunPathFor(surveyID, runID) + "/results"
}

// RunResults renders screen 7.
func (h *Surveys) RunResults(w http.ResponseWriter, r *http.Request) {
	one, run, ok := h.surveyRun(w, r)
	if !ok {
		return
	}
	filter := parseFilter(r.URL.Query())
	results, err := h.Service.RunResults(r.Context(), one.ID, run.ID, filter)
	switch {
	case errors.Is(err, survey.ErrRunNotClosed):
		flash.Set(w, h.secureCookie, "Los resultados aparecen cuando la pasada se cierra.")
		http.Redirect(w, r, SurveyRunPathFor(one.ID, run.ID), http.StatusSeeOther)
		return
	case errors.Is(err, survey.ErrBadFilter):
		// A hand-edited or stale query: show the run unfiltered.
		http.Redirect(w, r, SurveyRunResultsPathFor(one.ID, run.ID), http.StatusSeeOther)
		return
	case err != nil:
		h.Log.Error("computing a run's results", "run", run.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	closed, err := h.Service.ClosedRuns(r.Context(), one.ID)
	if err != nil {
		h.Log.Error("listing closed runs", "survey", one.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}

	page := view.SurveyResultsPage{
		Page:       middleware.PageFor(r, "Resultados · "+runTitle(run)),
		SurveyName: one.Name,
		SurveyURL:  SurveyPathFor(one.ID),
		Title:      runTitle(run),
		Action:     SurveyRunResultsPathFor(one.ID, run.ID),
		ClearURL:   SurveyRunResultsPathFor(one.ID, run.ID),
		Filtered:   filter != nil,
		Copies:     results.Copies,
		ReadCopies: results.ReadCopies,
		CSVURL:     SurveyRunCSVPathFor(one.ID, run.ID),
		CompareURL: SurveyComparePathFor(one.ID),
	}
	for _, c := range closed {
		page.Runs = append(page.Runs, view.ResultRunLink{
			Label: fmt.Sprintf("#%d — %s — %d impresas", c.Number, c.AppliedOn, c.Copies),
			URL:   SurveyRunResultsPathFor(one.ID, c.ID), Current: c.ID == run.ID,
		})
	}
	for _, q := range results.Context {
		form := view.ResultFilterForm{QuestionID: q.ID, Statement: q.Statement}
		for _, a := range q.Alternatives {
			form.Options = append(form.Options, view.ResultFilterOption{
				ID: a.ID, Label: a.Label, Checked: filter != nil && filter.QuestionID == q.ID && contains(filter.AlternativeIDs, a.ID),
			})
		}
		page.Filters = append(page.Filters, form)
	}
	for _, sec := range results.Sections {
		sv := view.ResultSectionView{Label: sec.Label}
		for _, rq := range sec.Questions {
			block := resultBlock(rq.Number, rq.Stats, results.Copies)
			block.DetailURL = withFilter(SurveyRunResultQuestionPathFor(one.ID, run.ID, rq.Stats.Question.ID), filter)
			sv.Blocks = append(sv.Blocks, block)
		}
		page.Sections = append(page.Sections, sv)
	}
	page.Flash = flash.Consume(w, r, h.secureCookie)
	if err := view.RenderSurveyResults(w, page); err != nil {
		h.Log.Error("rendering a run's results", "error", err)
	}
}

// parseFilter reads ?ctx=<question>&alt=<alternative>…; nil without ctx.
// Unparsable ids are dropped, so the domain sees only numbers.
func parseFilter(q url.Values) *survey.ContextFilter {
	ctx, err := strconv.ParseInt(q.Get("ctx"), 10, 64)
	if err != nil || ctx <= 0 {
		return nil
	}
	f := &survey.ContextFilter{QuestionID: ctx}
	for _, v := range q["alt"] {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.AlternativeIDs = append(f.AlternativeIDs, id)
		}
	}
	return f
}

// resultBlock words one question's statistics for the page.
func resultBlock(number int, st survey.QuestionStats, copies int) view.ResultBlock {
	q := st.Question
	b := view.ResultBlock{Number: number, Statement: q.Statement, KindLabel: kindLabel(q)}
	if q.Kind == survey.KindMulti {
		b.Base = fmt.Sprintf("%% sobre %d %s", copies, plural(copies, "copia", "copias"))
	} else {
		b.Base = fmt.Sprintf("%d %s de %d %s", st.Answered, plural(st.Answered, "respuesta", "respuestas"), copies, plural(copies, "copia", "copias"))
	}
	var spoken []string
	for _, row := range st.Rows {
		label := alternativeLabel(q, row.Alternative)
		b.Bars = append(b.Bars, view.ResultBar{
			Label: label, Count: row.Count, Percent: percent(row.Percent), Width: int(math.Round(row.Percent)),
		})
		spoken = append(spoken, fmt.Sprintf("%s, %d %s", label, row.Count, plural(row.Count, "respuesta", "respuestas")))
	}
	b.AriaLabel = "Distribución: " + strings.Join(spoken, "; ")
	if st.Scale != nil {
		b.Summary = fmt.Sprintf("Promedio %s · Moda %s · Mediana %s",
			decimal(st.Scale.Mean), joinInts(st.Scale.Modes), decimal(st.Scale.Median))
	}
	return b
}

// percent is a share as the page shows it: "48 %".
func percent(p float64) string { return fmt.Sprintf("%.0f %%", p) }

// decimal shows a statistic with two decimals, but a whole number as one.
func decimal(v float64) string {
	if v == math.Trunc(v) {
		return strconv.FormatFloat(v, 'f', 0, 64)
	}
	return strconv.FormatFloat(v, 'f', 2, 64)
}

func joinInts(xs []int) string {
	parts := make([]string, len(xs))
	for i, x := range xs {
		parts[i] = strconv.Itoa(x)
	}
	return strings.Join(parts, ", ")
}

// SurveyRunResultQuestionPath is screen 6.
const SurveyRunResultQuestionPath = "/surveys/{id}/runs/{rid}/results/questions/{qid}"

// SurveyRunResultQuestionPathFor builds screen 6's URL.
func SurveyRunResultQuestionPathFor(surveyID, runID, questionID int64) string {
	return SurveyRunResultsPathFor(surveyID, runID) + "/questions/" + strconv.FormatInt(questionID, 10)
}

// withFilter carries a filter's query onto a URL.
func withFilter(path string, f *survey.ContextFilter) string {
	if f == nil {
		return path
	}
	q := url.Values{"ctx": {strconv.FormatInt(f.QuestionID, 10)}}
	for _, a := range f.AlternativeIDs {
		q.Add("alt", strconv.FormatInt(a, 10))
	}
	return path + "?" + q.Encode()
}

// RunResultQuestion renders screen 6.
func (h *Surveys) RunResultQuestion(w http.ResponseWriter, r *http.Request) {
	one, run, ok := h.surveyRun(w, r)
	if !ok {
		return
	}
	qid, err := strconv.ParseInt(r.PathValue("qid"), 10, 64)
	if err != nil || qid <= 0 {
		middleware.WriteError(w, r, http.StatusNotFound, "Esa pregunta no existe en esta pasada.")
		return
	}
	filter := parseFilter(r.URL.Query())
	res, err := h.Service.QuestionResults(r.Context(), one.ID, run.ID, qid, filter)
	switch {
	case errors.Is(err, survey.ErrRunNotClosed):
		flash.Set(w, h.secureCookie, "Los resultados aparecen cuando la pasada se cierra.")
		http.Redirect(w, r, SurveyRunPathFor(one.ID, run.ID), http.StatusSeeOther)
		return
	case errors.Is(err, survey.ErrBadFilter):
		http.Redirect(w, r, SurveyRunResultQuestionPathFor(one.ID, run.ID, qid), http.StatusSeeOther)
		return
	case errors.Is(err, survey.ErrQuestionNotInRun):
		middleware.WriteError(w, r, http.StatusNotFound, "Esa pregunta no existe en esta pasada.")
		return
	case err != nil:
		h.Log.Error("computing a question's results", "run", run.ID, "question", qid, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	page := view.SurveyResultQuestionPage{
		Page:       middleware.PageFor(r, fmt.Sprintf("Pregunta %d · %s", res.Number, runTitle(run))),
		RunTitle:   runTitle(run),
		ResultsURL: withFilter(SurveyRunResultsPathFor(one.ID, run.ID), filter),
		Block:      resultBlock(res.Number, res.Stats, res.Copies),
		Filtered:   filter != nil,
		Copies:     res.Copies,
		ReadCopies: res.ReadCopies,
	}
	for _, a := range res.Across {
		row := view.ResultAcrossRow{Label: fmt.Sprintf("Pasada %d", a.Run.Number), Current: a.Run.ID == run.ID, Summary: "—"}
		if a.Stats != nil {
			row.Summary = acrossSummary(*a.Stats)
		}
		page.Across = append(page.Across, row)
	}
	page.Flash = flash.Consume(w, r, h.secureCookie)
	if err := view.RenderSurveyResultQuestion(w, page); err != nil {
		h.Log.Error("rendering a question's results", "error", err)
	}
}

// acrossSummary is a question in one run, on one line: a scale's three
// numbers, or the most-marked alternative's share.
func acrossSummary(st survey.QuestionStats) string {
	if st.Scale != nil {
		return fmt.Sprintf("promedio %s · moda %s · mediana %s", decimal(st.Scale.Mean), joinInts(st.Scale.Modes), decimal(st.Scale.Median))
	}
	if st.Answered == 0 {
		return "sin respuestas"
	}
	best := st.Rows[0]
	for _, r := range st.Rows {
		if r.Count > best.Count {
			best = r
		}
	}
	return fmt.Sprintf("más marcada: %s, %s", alternativeLabel(st.Question, best.Alternative), percent(best.Percent))
}

// SurveyComparePath is screen 13.
const SurveyComparePath = "/surveys/{id}/compare"

// SurveyComparePathFor builds screen 13's URL.
func SurveyComparePathFor(surveyID int64) string { return SurveyPathFor(surveyID) + "/compare" }

// Compare renders screen 13: every question some closed run printed, one
// column per closed run, and Δ — sign only, no colour.
func (h *Surveys) Compare(w http.ResponseWriter, r *http.Request) {
	one, ok := h.survey(w, r)
	if !ok {
		return
	}
	metric := survey.Metric(r.URL.Query().Get("metric"))
	switch metric {
	case survey.MetricMode, survey.MetricMedian:
	default:
		metric = survey.MetricMean
	}
	cmp, err := h.Service.Compare(r.Context(), one.ID, metric)
	if err != nil {
		h.Log.Error("comparing a survey's runs", "survey", one.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	page := view.SurveyComparePage{
		Page:       middleware.PageFor(r, "Comparar pasadas · "+one.Name),
		SurveyName: one.Name,
		SurveyURL:  SurveyPathFor(one.ID),
		Summary: fmt.Sprintf("%d %s · %d %s", len(cmp.Runs), plural(len(cmp.Runs), "pasada cerrada", "pasadas cerradas"),
			len(cmp.Rows), plural(len(cmp.Rows), "pregunta", "preguntas")),
		CSVURL: SurveyCompareCSVPathFor(one.ID) + "?metric=" + string(metric),
	}
	for _, m := range []struct {
		metric survey.Metric
		label  string
	}{{survey.MetricMean, "Promedio"}, {survey.MetricMode, "Moda"}, {survey.MetricMedian, "Mediana"}} {
		page.Metrics = append(page.Metrics, view.CompareMetricLink{
			Label: m.label, URL: SurveyComparePathFor(one.ID) + "?metric=" + string(m.metric), Current: m.metric == metric,
		})
	}
	for _, run := range cmp.Runs {
		page.Columns = append(page.Columns, "P"+strconv.Itoa(run.Number))
	}
	for _, sec := range cmp.Sections() {
		g := view.CompareGroup{Label: sec.Label}
		for _, row := range sec.Rows {
			g.Rows = append(g.Rows, compareRow(row, metric))
		}
		page.Groups = append(page.Groups, g)
	}
	page.Flash = flash.Consume(w, r, h.secureCookie)
	if err := view.RenderSurveyCompare(w, page); err != nil {
		h.Log.Error("rendering the comparison", "error", err)
	}
}

// compareRow words one row: numbered by the bank (a question's printed
// number differs between runs), its values, and Δ with its sign.
func compareRow(row survey.ComparisonRow, metric survey.Metric) view.CompareRow {
	q := row.Question
	out := view.CompareRow{Number: q.Position, Label: q.Statement, Delta: "—"}
	switch {
	case row.Context:
		out.Label += " (contexto)"
	case row.Reference != nil:
		out.Label += " · % " + alternativeLabel(q, *row.Reference)
	}
	for _, c := range row.Cells {
		out.Cells = append(out.Cells, compareValue(c, row.Percent, metric))
	}
	if row.Delta != nil {
		out.Delta = compareDelta(*row.Delta, row.Percent)
	}
	return out
}

func compareValue(c survey.ComparisonCell, isPercent bool, metric survey.Metric) string {
	switch {
	case !c.Present:
		return "—"
	case isPercent:
		return percent(c.Value)
	case metric == survey.MetricMean:
		return strconv.FormatFloat(c.Value, 'f', 2, 64)
	}
	return decimal(c.Value)
}

// compareDelta is Δ with an arrow and its sign; points for percentages.
func compareDelta(d float64, isPercent bool) string {
	text := fmt.Sprintf("%+.2f", d)
	if isPercent {
		text = fmt.Sprintf("%+.0f pp", d)
	}
	switch {
	case math.Abs(d) < 0.005:
		return "= 0"
	case d > 0:
		return "↑ " + text
	}
	return "↓ " + strings.Replace(text, "-", "−", 1)
}
