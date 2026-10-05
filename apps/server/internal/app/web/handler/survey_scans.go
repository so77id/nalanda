package handler

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// A run's scans (issue #311, screen 10): upload a batch, see what was
// read. The upload writes the batch on the request goroutine and queues a
// `survey_analyse` job; nothing here calls the worker (ADR-0079).

// SurveyRunScansPath is screen 10 (GET) and the upload (POST).
const SurveyRunScansPath = "/surveys/{id}/runs/{rid}/scans"

// SurveyRunScansPathFor builds the URL of a run's scans.
func SurveyRunScansPathFor(surveyID, runID int64) string {
	return SurveyRunPathFor(surveyID, runID) + "/scans"
}

// runTitle is how a run is named on its pages: "Pasada #3 · Mitad".
func runTitle(run survey.Run) string {
	title := "Pasada #" + strconv.Itoa(run.Number)
	if run.Name != "" {
		title += " · " + run.Name
	}
	return title
}

// RunScans renders screen 10.
func (h *Surveys) RunScans(w http.ResponseWriter, r *http.Request) {
	one, run, ok := h.surveyRun(w, r)
	if !ok {
		return
	}
	uploads, err := h.Service.Uploads(run)
	if err != nil {
		h.Log.Error("listing a run's uploads", "run", run.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	counts, err := h.Service.ReadingCounts(r.Context(), run.ID)
	if err != nil {
		h.Log.Error("counting a run's reading", "run", run.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	page := view.SurveyRunScansPage{
		Page:         middleware.PageFor(r, "Escaneos · "+runTitle(run)),
		RunTitle:     runTitle(run),
		RunURL:       SurveyRunPathFor(one.ID, run.ID),
		Banner:       runBanner(h.latestRunJob(r.Context(), run)),
		CanUpload:    run.State == survey.RunOpen,
		UploadAction: SurveyRunScansPathFor(one.ID, run.ID),
		MaxMB:        h.MaxScanBytes >> 20,
		Read:         counts.Copies,
		Clean:        counts.Clean(),
		Pending:      counts.PendingCopies,
	}
	if run.State == survey.RunOpen && (survey.ScanSummary{Uploads: len(uploads), Copies: counts.Copies}).HasScans() {
		page.ResetURL = SurveyRunScansResetConfirmPathFor(one.ID, run.ID)
	}
	for _, u := range uploads {
		page.Uploads = append(page.Uploads, view.UploadRow{Name: u.Name, Size: humanBytes(u.Bytes)})
	}
	page.Flash = flash.Consume(w, r, h.secureCookie)
	if err := view.RenderSurveyRunScans(w, page); err != nil {
		h.Log.Error("rendering a run's scans", "error", err)
	}
}

// UploadScans takes one scanned batch (POST, multipart): it writes the PDF
// before it queues the reading, so the batch survives anything the job
// meets (apps/server/CLAUDE.md, #210), and lands on screen 10, whose
// banner follows the reading.
func (h *Surveys) UploadScans(w http.ResponseWriter, r *http.Request) {
	one, run, ok := h.surveyRun(w, r)
	if !ok {
		return
	}
	back := SurveyRunScansPathFor(one.ID, run.ID)
	if run.State != survey.RunOpen {
		flash.Set(w, h.secureCookie, "Esta pasada ya no está abierta: no recibe escaneos.")
		http.Redirect(w, r, SurveyRunPathFor(one.ID, run.ID), http.StatusSeeOther)
		return
	}

	// Reading a large batch over a slow link outlives the server's global
	// write timeout; this route claims the window the controls' upload does.
	controller := http.NewResponseController(w)
	if err := controller.SetWriteDeadline(time.Now().Add(uploadWriteWindow)); err != nil &&
		!errors.Is(err, http.ErrNotSupported) {
		h.Log.Warn("surveys: cannot extend the upload write deadline", "error", err)
	}
	if h.MaxScanBytes > 0 {
		r.Body = http.MaxBytesReader(w, r.Body, h.MaxScanBytes)
	}
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			flash.Set(w, h.secureCookie, fmt.Sprintf("El PDF excede el máximo de %d MB.", h.MaxScanBytes>>20))
		} else {
			flash.Set(w, h.secureCookie, "No se pudo leer el formulario. Vuelve a intentarlo.")
		}
		http.Redirect(w, r, back, http.StatusSeeOther)
		return
	}
	file, header, err := r.FormFile(scanFormField)
	if err != nil {
		flash.Set(w, h.secureCookie, "Elige un PDF antes de subir.")
		http.Redirect(w, r, back, http.StatusSeeOther)
		return
	}
	if !looksLikePDF(header.Filename, header.Header.Get("Content-Type")) {
		_ = file.Close()
		flash.Set(w, h.secureCookie, "El archivo debe ser un PDF.")
		http.Redirect(w, r, back, http.StatusSeeOther)
		return
	}

	batch, err := h.Service.SaveUploadedBatch(r.Context(), one.ID, run.ID, file)
	switch {
	case errors.Is(err, survey.ErrRunNotOpen):
		flash.Set(w, h.secureCookie, "Esta pasada ya no está abierta: no recibe escaneos.")
		http.Redirect(w, r, SurveyRunPathFor(one.ID, run.ID), http.StatusSeeOther)
		return
	case err != nil:
		h.Log.Error("surveys: saving an uploaded batch", "run", run.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"El servidor no pudo guardar el escaneo. Vuelve a intentarlo en unos minutos.")
		return
	}
	if _, err := h.Runner.Submit(r.Context(), strconv.FormatInt(run.ID, 10), jobs.KindSurveyAnalyse,
		survey.EncodeAnalysePayload(one.ID, batch)); err != nil {
		// The batch stays on disk: a later upload or an operator can read it.
		h.Log.Error("surveys: queueing a batch's reading", "run", run.ID, "batch", batch, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"El escaneo quedó guardado, pero no se pudo encolar su lectura. Vuelve a intentarlo.")
		return
	}
	flash.Set(w, h.secureCookie, fmt.Sprintf("Lote %s subido. Se está leyendo: refresca cuando el aviso cambie.", batch))
	http.Redirect(w, r, back, http.StatusSeeOther)
}

// humanBytes is a file size as a professor reads it.
func humanBytes(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%d KB", n>>10)
	}
	return fmt.Sprintf("%d B", n)
}
