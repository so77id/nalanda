package handler

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// The review queue (issue #311, screen 11): one copy at a time, its page
// images beside its doubtful answers — the controls' review style, with no
// code shared across the boundary (ADR-0078).

// Review routes.
const (
	SurveyRunReviewPath     = "/surveys/{id}/runs/{rid}/review"
	SurveyRunReviewCopyPath = "/surveys/{id}/runs/{rid}/review/{copy}"
	SurveyRunPagePath       = "/surveys/{id}/runs/{rid}/copies/{copy}/page/{n}"
)

// SurveyRunReviewPathFor builds the review queue's entry.
func SurveyRunReviewPathFor(surveyID, runID int64) string {
	return SurveyRunPathFor(surveyID, runID) + "/review"
}

// SurveyRunReviewCopyPathFor builds one copy's review page.
func SurveyRunReviewCopyPathFor(surveyID, runID int64, copyNumber int) string {
	return SurveyRunReviewPathFor(surveyID, runID) + "/" + strconv.Itoa(copyNumber)
}

// SurveyRunPagePathFor builds one scanned page's image URL.
func SurveyRunPagePathFor(surveyID, runID int64, copyNumber, page int) string {
	return fmt.Sprintf("%s/copies/%d/page/%d", SurveyRunPathFor(surveyID, runID), copyNumber, page)
}

// RunReview sends the professor to the first copy that waits, or back to
// the run when none does.
func (h *Surveys) RunReview(w http.ResponseWriter, r *http.Request) {
	one, run, ok := h.surveyRun(w, r)
	if !ok {
		return
	}
	pending, err := h.Service.PendingCopies(r.Context(), run.ID)
	if err != nil {
		h.Log.Error("listing a run's pending copies", "run", run.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	if len(pending) == 0 {
		flash.Set(w, h.secureCookie, "No hay lecturas por revisar en esta pasada.")
		http.Redirect(w, r, SurveyRunPathFor(one.ID, run.ID), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, SurveyRunReviewCopyPathFor(one.ID, run.ID, pending[0]), http.StatusSeeOther)
}

// ReviewCopy renders one copy's review page.
func (h *Surveys) ReviewCopy(w http.ResponseWriter, r *http.Request) {
	one, run, ok := h.surveyRun(w, r)
	if !ok {
		return
	}
	copyNumber, ok := pathCopy(w, r)
	if !ok {
		return
	}
	h.renderCopyReview(w, r, one, run, copyNumber, http.StatusOK, nil)
}

// ResolveCopy records the decisions posted for one copy and moves on to the
// next copy that waits — "Guardar y seguir".
func (h *Surveys) ResolveCopy(w http.ResponseWriter, r *http.Request) {
	one, run, ok := h.surveyRun(w, r)
	if !ok {
		return
	}
	copyNumber, ok := pathCopy(w, r)
	if !ok {
		return
	}
	if err := r.ParseForm(); err != nil {
		h.renderCopyReview(w, r, one, run, copyNumber, http.StatusUnprocessableEntity,
			[]string{"No se pudo leer el formulario. Vuelve a intentarlo."})
		return
	}
	var decisions []survey.Decision
	for key, values := range r.PostForm {
		idText, found := strings.CutPrefix(key, "choice_")
		if !found {
			continue
		}
		itemID, err := strconv.ParseInt(idText, 10, 64)
		if err != nil {
			continue
		}
		d := survey.Decision{ItemID: itemID, Comment: strings.TrimSpace(r.PostFormValue("comment_" + idText))}
		for _, v := range values {
			if v == "discard" {
				d.Discard = true
				continue
			}
			alt, err := strconv.ParseInt(v, 10, 64)
			if err == nil {
				d.AlternativeIDs = append(d.AlternativeIDs, alt)
			}
		}
		if d.Discard {
			d.AlternativeIDs = nil // "Descartar" wins over a box left ticked
		}
		decisions = append(decisions, d)
	}

	professor, _ := middleware.ProfessorFrom(r.Context())
	_, err := h.Service.ResolveCopy(r.Context(), one.ID, run.ID, copyNumber, decisions, professor.ID)
	switch {
	case errors.Is(err, survey.ErrBadChoice):
		h.renderCopyReview(w, r, one, run, copyNumber, http.StatusUnprocessableEntity,
			[]string{"Una pregunta de una sola respuesta registra exactamente una alternativa."})
		return
	case errors.Is(err, survey.ErrItemResolved):
		flash.Set(w, h.secureCookie, "Esa lectura ya estaba resuelta.")
	case errors.Is(err, survey.ErrRunNotOpen):
		flash.Set(w, h.secureCookie, "Esta pasada ya no está abierta: no se revisa.")
		http.Redirect(w, r, SurveyRunPathFor(one.ID, run.ID), http.StatusSeeOther)
		return
	case errors.Is(err, survey.ErrCopyNotFound), errors.Is(err, survey.ErrItemNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Esa copia no existe en esta pasada.")
		return
	case err != nil:
		h.Log.Error("resolving a copy's review", "run", run.ID, "copy", copyNumber, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}

	pending, err := h.Service.PendingCopies(r.Context(), run.ID)
	if err != nil {
		h.Log.Error("listing a run's pending copies", "run", run.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	if next, ok := nextAfter(pending, copyNumber); ok {
		http.Redirect(w, r, SurveyRunReviewCopyPathFor(one.ID, run.ID, next), http.StatusSeeOther)
		return
	}
	flash.Set(w, h.secureCookie, "Revisión completa: ya puedes cerrar la pasada.")
	http.Redirect(w, r, SurveyRunPathFor(one.ID, run.ID), http.StatusSeeOther)
}

// nextAfter is the first waiting copy after n, wrapping to the first; ok is
// false when none waits.
func nextAfter(pending []int, n int) (int, bool) {
	for _, p := range pending {
		if p > n {
			return p, true
		}
	}
	if len(pending) > 0 {
		return pending[0], true
	}
	return 0, false
}

// RunPage streams one scanned page image of a read copy.
func (h *Surveys) RunPage(w http.ResponseWriter, r *http.Request) {
	_, run, ok := h.surveyRun(w, r)
	if !ok {
		return
	}
	copyNumber, ok := pathCopy(w, r)
	if !ok {
		return
	}
	page, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || page < 1 || page > 99 {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese archivo no existe.")
		return
	}
	// Only a copy the run read has pages to show.
	if _, err := h.Service.CopyReading(r.Context(), run.ID, copyNumber); err != nil {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese archivo no existe.")
		return
	}
	path, ctype, err := h.Service.ScanImage(run, copyNumber, page)
	if err != nil {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese archivo no existe.")
		return
	}
	f, err := os.Open(path)
	if err != nil {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese archivo no existe.")
		return
	}
	defer func() { _ = f.Close() }()
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "private, no-store")
	if _, err := io.Copy(w, f); err != nil {
		h.Log.Warn("streaming a scanned page", "run", run.ID, "copy", copyNumber, "error", err)
	}
}

// pathCopy reads {copy}; a bad one answers 404.
func pathCopy(w http.ResponseWriter, r *http.Request) (int, bool) {
	n, err := strconv.Atoi(r.PathValue("copy"))
	if err != nil || n < 1 || n > survey.MaxCopies {
		middleware.WriteError(w, r, http.StatusNotFound, "Esa copia no existe en esta pasada.")
		return 0, false
	}
	return n, true
}

func (h *Surveys) renderCopyReview(w http.ResponseWriter, r *http.Request, one survey.Survey, run survey.Run, copyNumber, status int, problems []string) {
	ctx := r.Context()
	reading, err := h.Service.CopyReading(ctx, run.ID, copyNumber)
	if errors.Is(err, survey.ErrCopyNotFound) {
		middleware.WriteError(w, r, http.StatusNotFound, "Esa copia no existe en esta pasada.")
		return
	}
	if err != nil {
		h.Log.Error("reading a copy", "run", run.ID, "copy", copyNumber, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	questions, numbers, err := h.Service.QuestionsOf(ctx, run)
	if err != nil {
		h.Log.Error("reading a run's questions", "run", run.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	pending, err := h.Service.PendingCopies(ctx, run.ID)
	if err != nil {
		h.Log.Error("listing a run's pending copies", "run", run.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}

	page := view.SurveyCopyReviewPage{
		Page:     middleware.PageFor(r, fmt.Sprintf("Copia %d · %s", copyNumber, runTitle(run))),
		RunTitle: runTitle(run),
		RunURL:   SurveyRunPathFor(one.ID, run.ID),
		Waiting:  len(pending),
		Action:   SurveyRunReviewCopyPathFor(one.ID, run.ID, copyNumber),
		Editable: run.State == survey.RunOpen,
		Errors:   problems,
	}
	for i, n := range pending {
		if n != copyNumber {
			continue
		}
		page.Position = fmt.Sprintf("Copia %d de %d", i+1, len(pending))
		if i > 0 {
			page.PrevURL = SurveyRunReviewCopyPathFor(one.ID, run.ID, pending[i-1])
		}
	}
	if next, ok := nextAfter(pending, copyNumber); ok && next != copyNumber {
		page.NextURL = SurveyRunReviewCopyPathFor(one.ID, run.ID, next)
	}
	for _, p := range reading.Copy.Pages {
		page.Pages = append(page.Pages, SurveyRunPagePathFor(one.ID, run.ID, copyNumber, p))
	}
	for _, it := range reading.Items {
		page.Items = append(page.Items, reviewItemView(it, questions[it.QuestionID], numbers[it.QuestionID]))
	}
	if err := view.RenderSurveyCopyReview(w, status, page); err != nil {
		h.Log.Error("rendering a copy's review", "error", err)
	}
}

// reviewItemView words one item for the page: what was seen, and every
// alternative the question offers — the detected ones marked, because the
// reader may have missed the box the student meant.
func reviewItemView(it survey.ReviewItem, q survey.Question, number int) view.ReviewItemView {
	labels := make(map[int64]string, len(q.Alternatives))
	for _, a := range q.Alternatives {
		labels[a.ID] = alternativeLabel(q, a)
	}
	detected := map[int64]bool{}
	for _, id := range append(append([]int64(nil), it.Marked...), it.Doubtful...) {
		detected[id] = true
	}
	out := view.ReviewItemView{
		ID:        it.ID,
		Heading:   fmt.Sprintf("Pregunta %d", number),
		Statement: q.Statement,
		KindLabel: kindLabel(q),
		Multi:     q.Kind == survey.KindMulti,
		Comment:   it.Comment,
	}
	names := func(ids []int64) string {
		parts := make([]string, 0, len(ids))
		for _, id := range ids {
			parts = append(parts, labels[id])
		}
		return strings.Join(parts, " y ")
	}
	switch it.Reason {
	case survey.ReasonAmbiguous:
		out.Explanation = fmt.Sprintf("Se detectaron %d marcas (%s) en una pregunta de una sola respuesta.",
			len(it.Marked), names(it.Marked))
	default:
		out.Explanation = "Marca dudosa en " + names(it.Doubtful) + "."
		if len(it.Marked) > 0 {
			out.Explanation += " Marca clara en " + names(it.Marked) + "."
		}
	}
	for _, a := range q.Alternatives {
		out.Options = append(out.Options, view.ReviewOption{
			Value:    strconv.FormatInt(a.ID, 10),
			Label:    labels[a.ID],
			Detected: detected[a.ID],
			// A multi-select starts from what the reader was sure of.
			Checked: out.Multi && contains(it.Marked, a.ID),
		})
	}
	switch it.Resolution {
	case survey.ResolutionDiscarded:
		out.Decided = "descartada (sin respuesta)"
	case survey.ResolutionChosen:
		out.Decided = "registrada"
	}
	return out
}

// alternativeLabel is how an alternative reads on the page: a scale point
// is its value, with its words when it has any.
func alternativeLabel(q survey.Question, a survey.Alternative) string {
	if q.Kind != survey.KindScale {
		return a.Label
	}
	if a.Label == "" {
		return strconv.Itoa(a.Position)
	}
	return fmt.Sprintf("%d (%s)", a.Position, a.Label)
}

func contains(ids []int64, id int64) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}
