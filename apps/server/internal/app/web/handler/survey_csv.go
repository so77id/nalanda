package handler

import (
	"errors"
	"fmt"
	"hash/fnv"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// The three CSV exports (issue #312): UTF-8 with a BOM, comma-separated,
// every field quoted — Excel, Numbers and pandas.read_csv all read that the
// same way. AMC copy numbers never leave the server: the raw export
// numbers its rows 1…N.

// Export routes.
const (
	SurveyBankCSVPath    = "/surveys/{id}/bank.csv"
	SurveyRunCSVPath     = "/surveys/{id}/runs/{rid}/results.csv"
	SurveyCompareCSVPath = "/surveys/{id}/compare.csv"
)

// SurveyBankCSVPathFor builds the bank export's URL.
func SurveyBankCSVPathFor(surveyID int64) string { return SurveyPathFor(surveyID) + "/bank.csv" }

// SurveyRunCSVPathFor builds a run's raw export's URL.
func SurveyRunCSVPathFor(surveyID, runID int64) string {
	return SurveyRunPathFor(surveyID, runID) + "/results.csv"
}

// SurveyCompareCSVPathFor builds the comparison export's URL.
func SurveyCompareCSVPathFor(surveyID int64) string { return SurveyPathFor(surveyID) + "/compare.csv" }

// BankCSV exports the bank: one row per alternative.
func (h *Surveys) BankCSV(w http.ResponseWriter, r *http.Request) {
	one, ok := h.survey(w, r)
	if !ok {
		return
	}
	questions, err := h.Service.Questions(r.Context(), one.ID)
	if err != nil {
		h.Log.Error("exporting a bank", "survey", one.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	rows := [][]string{{"Pregunta", "Sección", "Tipo", "Contexto", "Enunciado", "Mín. marcas", "Máx. marcas", "Alternativa", "Etiqueta"}}
	for _, q := range questions {
		context := "no"
		if q.IsContext {
			context = "sí"
		}
		for _, a := range q.Alternatives {
			rows = append(rows, []string{
				strconv.Itoa(q.Position), text(q.Section), kindName(q.Kind), context, text(q.Statement),
				intOrEmpty(q.MinMarks), intOrEmpty(q.MaxMarks), strconv.Itoa(a.Position), text(a.Label),
			})
		}
	}
	writeCSV(w, fmt.Sprintf("encuesta-%d-banco.csv", one.ID), rows)
}

// RunCSV exports a closed run's raw answers: one row per copy, one column
// per printed question.
func (h *Surveys) RunCSV(w http.ResponseWriter, r *http.Request) {
	one, run, ok := h.surveyRun(w, r)
	if !ok {
		return
	}
	answers, err := h.Service.RunAnswers(r.Context(), one.ID, run.ID)
	switch {
	case errors.Is(err, survey.ErrRunNotClosed):
		h.redirectNotClosed(w, r, one.ID, run.ID)
		return
	case err != nil:
		h.Log.Error("exporting a run", "run", run.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	header := []string{"Copia"}
	for _, q := range answers.Questions {
		header = append(header, text(fmt.Sprintf("P%d · %s", answers.Numbers[q.ID], q.Statement)))
	}
	rows := [][]string{header}
	for i, c := range shuffled(answers.Run.ID, answers.Copies) {
		row := []string{strconv.Itoa(i + 1)}
		for _, q := range answers.Questions {
			row = append(row, rawCell(q, c.Marks[q.ID]))
		}
		rows = append(rows, row)
	}
	writeCSV(w, fmt.Sprintf("encuesta-%d-pasada-%d.csv", one.ID, run.Number), rows)
}

// rawCell is one answer: a single's label, a scale's number, a multi's
// labels joined by " | ", and "" for no answer.
func rawCell(q survey.Question, marked []int64) string {
	byID := map[int64]survey.Alternative{}
	for _, a := range q.Alternatives {
		byID[a.ID] = a
	}
	var parts []string
	for _, id := range marked {
		a := byID[id]
		if q.Kind == survey.KindScale {
			parts = append(parts, strconv.Itoa(a.Position))
		} else {
			parts = append(parts, a.Label)
		}
	}
	return text(strings.Join(parts, " | "))
}

// CompareCSV exports the comparison table, with the metric screen 13 had.
func (h *Surveys) CompareCSV(w http.ResponseWriter, r *http.Request) {
	one, ok := h.survey(w, r)
	if !ok {
		return
	}
	metric := survey.ParseMetric(r.URL.Query().Get("metric"))
	cmp, err := h.Service.Compare(r.Context(), one.ID, metric)
	if err != nil {
		h.Log.Error("exporting the comparison", "survey", one.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	// Bare numbers, for analysis (#312 review, ARQ-1/COR-3): a scale row in
	// the chosen metric, a single or multi row as the reference
	// alternative's percent (0-100), an empty cell for "—"; what each row
	// measures is its own column, and the metric names the file.
	header := []string{"Pregunta", "Enunciado", "Medida"}
	for _, run := range cmp.Runs {
		header = append(header, "P"+strconv.Itoa(run.Number))
	}
	header = append(header, "Δ")
	rows := [][]string{header}
	for _, row := range cmp.Rows {
		q := row.Question
		measure := string(metric)
		switch {
		case row.Context:
			measure = "contexto"
		case row.Percent && row.Reference != nil:
			measure = "% " + alternativeLabel(q, *row.Reference)
		case row.Percent:
			measure = "%"
		}
		line := []string{strconv.Itoa(q.Position), text(q.Statement), text(measure)}
		for _, c := range row.Cells {
			line = append(line, csvNumber(c.Present, c.Value, row.Percent))
		}
		delta := ""
		if row.Delta != nil {
			delta = csvNumber(true, *row.Delta, row.Percent)
		}
		rows = append(rows, append(line, delta))
	}
	writeCSV(w, fmt.Sprintf("encuesta-%d-comparacion-%s.csv", one.ID, metric), rows)
}

// csvNumber is a value as the export writes it: two decimals for a scale,
// one for a percent, empty when there is none.
func csvNumber(present bool, v float64, isPercent bool) string {
	if !present {
		return ""
	}
	if isPercent {
		return strconv.FormatFloat(v, 'f', 1, 64)
	}
	return strconv.FormatFloat(v, 'f', 2, 64)
}

// shuffled reorders a run's copies by a hash of (run, copy number): the
// same order on every export of the run, and none that follows the copy
// numbers - the row number must not stand in for one (#312 review, SEC-1).
func shuffled(runID int64, copies []survey.CopyMarks) []survey.CopyMarks {
	out := append([]survey.CopyMarks(nil), copies...)
	key := func(n int) uint64 {
		h := fnv.New64a()
		_, _ = fmt.Fprintf(h, "%d/%d", runID, n)
		return h.Sum64()
	}
	sort.SliceStable(out, func(i, j int) bool { return key(out[i].CopyNumber) < key(out[j].CopyNumber) })
	return out
}

// writeCSV writes rows as an attachment: a BOM, then every field quoted.
func writeCSV(w http.ResponseWriter, filename string, rows [][]string) {
	var b strings.Builder
	b.WriteString("\ufeff")
	for _, row := range rows {
		for i, field := range row {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteByte('"')
			b.WriteString(strings.ReplaceAll(field, `"`, `""`))
			b.WriteByte('"')
		}
		b.WriteString("\r\n")
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write([]byte(b.String()))
}

// text neutralises a typed string a spreadsheet would run as a formula —
// one starting with = + - @ (or a tab or carriage return) gets a leading
// apostrophe. Numbers this code writes never pass through it.
func text(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}

func intOrEmpty(p *int) string {
	if p == nil {
		return ""
	}
	return strconv.Itoa(*p)
}
