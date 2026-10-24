package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/domain/uploads"
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

// SurveyRunScanUploadsPath opens a chunked upload of a batch for an open run
// (POST, JSON from the page's script; issue #339).
const SurveyRunScanUploadsPath = "/surveys/{id}/runs/{rid}/scans/uploads"

// SurveyRunScanUploadCompletePath turns a finished one into the run's next
// batch and queues its reading.
const SurveyRunScanUploadCompletePath = "/surveys/{id}/runs/{rid}/scans/uploads/{uid}/complete"

// SurveyRunScanUploadsPathFor builds a run's start URL.
func SurveyRunScanUploadsPathFor(surveyID, runID int64) string {
	return SurveyRunScansPathFor(surveyID, runID) + "/uploads"
}

// SurveyRunScanUploadCompletePathFor builds the URL that finishes one upload.
func SurveyRunScanUploadCompletePathFor(surveyID, runID int64, uid string) string {
	return SurveyRunScanUploadsPathFor(surveyID, runID) + "/" + uid + "/complete"
}

// runNotOpen is what an upload to a closed or cancelled run reads.
const runNotOpen = "Esta pasada ya no está abierta: no recibe escaneos."

// runSubject is how the chunked uploads know a run.
func runSubject(run survey.Run) uploads.Subject {
	return uploads.Subject{Kind: uploads.SubjectSurveyRun, ID: strconv.FormatInt(run.ID, 10)}
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
		Page:             middleware.PageFor(r, "Escaneos · "+runTitle(run)),
		RunTitle:         runTitle(run),
		RunURL:           SurveyRunPathFor(one.ID, run.ID),
		Banner:           runBanner(h.latestRunJob(r.Context(), run)),
		CanUpload:        run.State == survey.RunOpen,
		UploadAction:     SurveyRunScansPathFor(one.ID, run.ID),
		ChunkedUploadURL: SurveyRunScanUploadsPathFor(one.ID, run.ID),
		MaxMB:            h.MaxScanBytes >> 20,
		Read:             counts.Copies,
		Clean:            counts.Clean(),
		Pending:          counts.PendingCopies,
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
		flash.Set(w, h.secureCookie, runNotOpen)
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
		flash.Set(w, h.secureCookie, runNotOpen)
		http.Redirect(w, r, SurveyRunPathFor(one.ID, run.ID), http.StatusSeeOther)
		return
	case err != nil:
		h.Log.Error("surveys: saving an uploaded batch", "run", run.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"El servidor no pudo guardar el escaneo. Vuelve a intentarlo en unos minutos.")
		return
	}
	if err := h.submitReading(r.Context(), one, run, batch); err != nil {
		middleware.WriteError(w, r, http.StatusInternalServerError, readingNotQueued)
		return
	}
	flash.Set(w, h.secureCookie, batchReading(batch))
	http.Redirect(w, r, back, http.StatusSeeOther)
}

// readingNotQueued is what both upload paths say when the batch is saved and
// the queue refused it.
const readingNotQueued = "El escaneo quedó guardado, pero no se pudo encolar su lectura. Vuelve a intentarlo."

// submitReading queues the survey_analyse of a batch SaveUploadedBatch has
// just written — the second of the two calls both upload paths make, in the
// same order. The batch stays on disk whatever the queue answers: a later
// upload or an operator can read it.
func (h *Surveys) submitReading(ctx context.Context, one survey.Survey, run survey.Run, batch string) error {
	if _, err := h.Runner.Submit(ctx, strconv.FormatInt(run.ID, 10), jobs.KindSurveyAnalyse,
		survey.EncodeAnalysePayload(one.ID, batch)); err != nil {
		h.Log.Error("surveys: queueing a batch's reading", "run", run.ID, "batch", batch, "error", err)
		return err
	}
	return nil
}

// batchReading is the flash both upload paths leave on the run's scans.
func batchReading(batch string) string {
	return fmt.Sprintf("Lote %s subido. Se está leyendo: refresca cuando el aviso cambie.", batch)
}

// StartScanUpload opens a chunked upload of a batch for an open run (issue
// #339), refusing at once what the one-request form would refuse: a run that
// is not open, a size over the cap, a file that is not a PDF.
func (h *Surveys) StartScanUpload(w http.ResponseWriter, r *http.Request) {
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		writeUploadJSON(w, h.Log, http.StatusNotFound, uploadMessage{Message: "Esa pasada no existe."})
		return
	}
	one, run, ok := h.findRun(r, h.jsonRefusal(w))
	if !ok {
		return
	}
	if run.State != survey.RunOpen {
		writeUploadJSON(w, h.Log, http.StatusConflict, uploadMessage{Message: runNotOpen})
		return
	}
	start, ok := readUploadStart(w, r, h.Log, h.MaxScanBytes)
	if !ok {
		return
	}
	up, err := h.Uploads.Create(professor.ID, runSubject(run), start.Name, start.Size, nil)
	if err != nil {
		if uploadCreateRefusal(w, h.Log, err, h.MaxScanBytes) {
			return
		}
		h.Log.Error("surveys: opening a chunked upload", "run", run.ID, "error", err)
		writeUploadJSON(w, h.Log, http.StatusInternalServerError, uploadMessage{Message: surveyBroke})
		return
	}
	writeUploadOpened(w, h.Log, up, SurveyRunScanUploadCompletePathFor(one.ID, run.ID, up.ID))
}

// CompleteScanUpload turns a finished chunked upload into the run's next
// batch: survey.SaveUploadedBatch writes it (and refuses a run that closed
// meanwhile), the partial goes only after that returned, then the reading is
// queued — the one-request form's two calls, in its order (#210).
func (h *Surveys) CompleteScanUpload(w http.ResponseWriter, r *http.Request) {
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		writeUploadJSON(w, h.Log, http.StatusNotFound, uploadMessage{Message: uploadNotFound})
		return
	}
	one, run, ok := h.findRun(r, h.jsonRefusal(w))
	if !ok {
		return
	}
	uid := r.PathValue("uid")
	var batch string
	up, err := h.Uploads.Complete(professor.ID, uid, runSubject(run), func(_ uploads.Upload, content io.ReadCloser) error {
		var err error
		batch, err = h.Service.SaveUploadedBatch(r.Context(), one.ID, run.ID, content)
		return err
	})
	switch {
	case err == nil:
	case uploadCompleteRefusal(w, h.Log, err, up):
		return
	case errors.Is(err, survey.ErrRunNotOpen):
		writeUploadJSON(w, h.Log, http.StatusConflict, uploadMessage{Message: runNotOpen})
		return
	default:
		h.Log.Error("surveys: saving a chunked upload", "run", run.ID, "upload", uid, "error", err)
		writeUploadJSON(w, h.Log, http.StatusInternalServerError,
			uploadMessage{Message: "El servidor no pudo guardar el escaneo. Vuelve a intentarlo en unos minutos."})
		return
	}
	if err := h.submitReading(r.Context(), one, run, batch); err != nil {
		writeUploadJSON(w, h.Log, http.StatusInternalServerError, uploadMessage{Message: readingNotQueued})
		return
	}
	flash.Set(w, h.secureCookie, batchReading(batch))
	writeUploadJSON(w, h.Log, http.StatusOK, uploadFinished{Redirect: SurveyRunScansPathFor(one.ID, run.ID)})
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
