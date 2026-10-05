package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// "Borrar escaneos" for a survey run (issue #311): the destructive-confirm
// pair (add-a-backend-endpoint.md), mirroring the controls' #298 — and the
// SECOND synchronous worker call (ADR-0081): it only removes files, and the
// client never waits on the worker's lock.

// Reset routes.
const (
	SurveyRunScansResetConfirmPath = "/surveys/{id}/runs/{rid}/scans/reset/confirm"
	SurveyRunScansResetPath        = "/surveys/{id}/runs/{rid}/scans/reset"
)

// SurveyRunScansResetConfirmPathFor builds the confirmation page's URL.
func SurveyRunScansResetConfirmPathFor(surveyID, runID int64) string {
	return SurveyRunScansPathFor(surveyID, runID) + "/reset/confirm"
}

// SurveyRunScansResetPathFor builds the URL the reset is POSTed to.
func SurveyRunScansResetPathFor(surveyID, runID int64) string {
	return SurveyRunScansPathFor(surveyID, runID) + "/reset"
}

// resetPhrase is what the professor types to confirm: the run's number,
// as every page names it.
func resetPhrase(run survey.Run) string { return "Pasada " + strconv.Itoa(run.Number) }

// ScansResetConfirm renders the confirmation page: what goes, and the
// phrase to type.
func (h *Surveys) ScansResetConfirm(w http.ResponseWriter, r *http.Request) {
	one, run, summary, ok := h.scansResetTarget(w, r)
	if !ok {
		return
	}
	h.renderScansResetConfirm(w, r, one, run, summary, http.StatusOK, "", "")
}

// ScansReset erases the run's scans: worker first, then the copies.
func (h *Surveys) ScansReset(w http.ResponseWriter, r *http.Request) {
	one, run, summary, ok := h.scansResetTarget(w, r)
	if !ok {
		return
	}
	// Refused while a job about this run is in flight — a wipe racing its
	// own reading cannot be undone — and fails CLOSED on a read error, the
	// controls' #298 departure from the flash-and-fail-open rule.
	job, err := h.Jobs.LatestForSubject(r.Context(), jobs.SubjectSurveyRun, strconv.FormatInt(run.ID, 10))
	switch {
	case err == nil && !job.Status.IsTerminal():
		middleware.WriteError(w, r, http.StatusConflict,
			"Hay un trabajo en curso sobre esta pasada. Espera a que termine y vuelve a intentarlo.")
		return
	case err != nil && !errors.Is(err, jobs.ErrJobNotFound):
		h.Log.Error("survey scans reset: reading jobs", "run", run.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, "Algo se rompió en el servidor. No se borró nada.")
		return
	}
	if err := r.ParseForm(); err != nil {
		h.renderScansResetConfirm(w, r, one, run, summary, http.StatusBadRequest, "",
			"No se pudo leer el formulario. Inténtalo de nuevo.")
		return
	}
	typed := r.PostFormValue("confirm_name")
	if typed != resetPhrase(run) {
		h.renderScansResetConfirm(w, r, one, run, summary, http.StatusUnprocessableEntity, typed,
			"No coincide. Escribe exactamente lo que aparece arriba.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), scansResetDeadline)
	defer cancel()
	if err := h.Service.ResetScans(ctx, one.ID, run.ID); err != nil {
		switch {
		// First: past the worker every other cause (a deadline, a run
		// closed meanwhile) still means the files are gone.
		case errors.Is(err, survey.ErrResetHalfDone):
			// Past the worker: its files are gone and the database write
			// failed. Say so rather than "nothing was deleted".
			h.Log.Error("survey scans reset: database", "run", run.ID, "error", err)
			middleware.WriteError(w, r, http.StatusInternalServerError,
				"Se borraron los archivos de escaneo pero no las lecturas. Vuelve a intentarlo para terminar.")
		case errors.Is(err, survey.ErrNoScans):
			middleware.WriteError(w, r, http.StatusNotFound, "Esta pasada no tiene escaneos.")
		case errors.Is(err, survey.ErrRunNotOpen):
			middleware.WriteError(w, r, http.StatusNotFound, "Esta pasada ya no está abierta.")
		case errors.Is(err, survey.ErrAnalyzerBusy):
			middleware.WriteError(w, r, http.StatusConflict,
				"El motor de lectura está ocupado con otro trabajo; no se borró nada. Vuelve a intentarlo en unos minutos.")
		case errors.Is(err, survey.ErrAnalyzerRefused), errors.Is(err, survey.ErrAnalyzerUnavailable),
			errors.Is(err, context.DeadlineExceeded):
			h.Log.Error("survey scans reset: worker", "run", run.ID, "error", err)
			middleware.WriteError(w, r, http.StatusBadGateway,
				"El motor de lectura no pudo borrar los escaneos; no se borró nada. Vuelve a intentarlo en unos minutos.")
		default:
			// Before the worker (reading the run or its summary).
			h.Log.Error("survey scans reset", "run", run.ID, "error", err)
			middleware.WriteError(w, r, http.StatusInternalServerError, "Algo se rompió en el servidor. No se borró nada.")
		}
		return
	}
	// The last reading's banner speaks of scans that no longer exist.
	if job, err := h.Jobs.LatestForSubject(r.Context(), jobs.SubjectSurveyRun, strconv.FormatInt(run.ID, 10)); err == nil &&
		job.Status.IsTerminal() && job.Kind == jobs.KindSurveyAnalyse {
		if err := h.Jobs.MarkDismissed(r.Context(), job.ID, time.Now()); err != nil {
			h.Log.Warn("survey scans reset: dismissing the last banner", "run", run.ID, "error", err)
		}
	}
	flash.Set(w, h.secureCookie, "Escaneos de la "+runTitle(run)+" borrados. El próximo lote que subas será el primero.")
	http.Redirect(w, r, SurveyRunScansPathFor(one.ID, run.ID), http.StatusSeeOther)
}

// scansResetTarget resolves the run both routes act on, with the pair's
// shared precondition: an open run with something to erase, else 404 —
// the destructive form never surfaces for nothing.
func (h *Surveys) scansResetTarget(w http.ResponseWriter, r *http.Request) (survey.Survey, survey.Run, survey.ScanSummary, bool) {
	one, run, ok := h.surveyRun(w, r)
	if !ok {
		return survey.Survey{}, survey.Run{}, survey.ScanSummary{}, false
	}
	if run.State != survey.RunOpen {
		middleware.WriteError(w, r, http.StatusNotFound, "Esta pasada ya no está abierta.")
		return survey.Survey{}, survey.Run{}, survey.ScanSummary{}, false
	}
	summary, err := h.Service.ScanSummaryFor(r.Context(), run)
	if err != nil {
		h.Log.Error("survey scans reset: summary", "run", run.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return survey.Survey{}, survey.Run{}, survey.ScanSummary{}, false
	}
	if !summary.HasScans() {
		middleware.WriteError(w, r, http.StatusNotFound, "Esta pasada no tiene escaneos.")
		return survey.Survey{}, survey.Run{}, survey.ScanSummary{}, false
	}
	return one, run, summary, true
}

func (h *Surveys) renderScansResetConfirm(w http.ResponseWriter, r *http.Request, one survey.Survey, run survey.Run,
	summary survey.ScanSummary, status int, typed, mismatch string) {
	page := view.SurveyScansResetPage{
		Page:     middleware.PageFor(r, "Borrar escaneos · "+runTitle(run)),
		RunTitle: runTitle(run),
		RunURL:   SurveyRunPathFor(one.ID, run.ID),
		BackURL:  SurveyRunScansPathFor(one.ID, run.ID),
		Action:   SurveyRunScansResetPathFor(one.ID, run.ID),
		Phrase:   resetPhrase(run),
		Uploads:  summary.Uploads,
		Copies:   summary.Copies,
		Decided:  summary.Decided,
		Typed:    typed,
		Mismatch: mismatch,
	}
	if err := view.RenderSurveyScansReset(w, status, page); err != nil {
		h.Log.Error("rendering the scans reset confirmation", "error", err)
	}
}
