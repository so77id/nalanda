package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
)

// ControlScansPath is POST target for the upload form on /controls/:id.
const ControlScansPath = "/controls/{id}/scans"

// ControlReanalyzePath is POST target for the "re-leer con otra
// sensibilidad" form.
const ControlReanalyzePath = "/controls/{id}/reanalyze"

// ControlClosePath is POST target for "Cerrar corrección" (S8).
const ControlClosePath = "/controls/{id}/close"

// resolveThresholds parses the two optional form fields against the
// control's stored pair (the form prefill), and enforces the band rule.
// ok is false when a provided value fails to parse or the pair is
// invalid. Issue #197.
func resolveThresholds(rawTicked, rawUnsure string, c controls.Control) (float64, float64, bool) {
	ticked := parseFloatField(rawTicked, c.Ticked)
	unsure := parseFloatField(rawUnsure, c.Unsure)
	if !controls.ThresholdsValid(ticked, unsure) {
		return 0, 0, false
	}
	return ticked, unsure, true
}

// uploadWriteWindow is how long the upload handler may take before the
// server's write deadline cuts it. /analyse is minutes-class (53s for a
// 40-copy batch measured in ADR-0030) and the annotate loop adds seconds
// per clean copy on top; 15 minutes leaves room for the largest batch the
// form allows (maxCopies) without abandoning the bound the global
// writeTimeout exists to provide on every other route.
const uploadWriteWindow = 15 * time.Minute

// scanFormField is the multipart field the upload form posts under.
const scanFormField = "scan"

// UploadScan reads the multipart form, streams the PDF onto disk through the
// Service, and redirects back to /controls/:id with a flash message. Failure
// modes are visible to the professor as a redirect + flash; the 500 shell is
// reserved for the "operator has to look" ones (unknown control, worker
// unreachable).
func (h *Controls) UploadScan(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !isValidControlID(id) {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return
	}

	// The upload is the one minutes-class route on this surface: /analyse
	// plus the annotate loop outlive the server's global 30s write timeout
	// for any real batch (httpserver.writeTimeout bounds the whole
	// handler, not a single Write). The default bound stays for everything
	// else; this route claims the time its design says it needs. Under a
	// recorder without controller support the call answers
	// http.ErrNotSupported, which is harmless — the deadline is a
	// production property, not a test one.
	controller := http.NewResponseController(w)
	if err := controller.SetWriteDeadline(time.Now().Add(uploadWriteWindow)); err != nil &&
		!errors.Is(err, http.ErrNotSupported) {
		h.Log.Warn("controls: cannot extend the upload write deadline", "error", err)
	}

	// http.MaxBytesReader wraps r.Body so any read past MaxScanBytes returns
	// an error. FormFile below reads it, so the limit is enforced there.
	if h.MaxScanBytes > 0 {
		r.Body = http.MaxBytesReader(w, r.Body, h.MaxScanBytes)
	}

	// ParseMultipartForm decides how many bytes are kept in memory; the rest
	// spills to a temp file. 32 MiB matches Go's default and is comfortably
	// above a single-copy scan.
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			flash.Set(w, h.secureCookie,
				fmt.Sprintf("El PDF excede el máximo de %d MB.", h.MaxScanBytes>>20))
			http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
			return
		}
		flash.Set(w, h.secureCookie, "No se pudo leer el formulario. Vuelve a intentarlo.")
		http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
		return
	}

	file, header, err := r.FormFile(scanFormField)
	if err != nil {
		flash.Set(w, h.secureCookie, "Elige un PDF antes de subir.")
		http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
		return
	}
	// FormFile's returned reader honours the same body limit MaxBytesReader
	// wrapped above — a file the header claims is small but reads long is
	// still refused.

	// A minimal content-type / filename sniff. The worker refuses non-PDFs
	// itself, but a nicer message here saves a round trip when a professor
	// picks the wrong file.
	if !looksLikePDF(header.Filename, header.Header.Get("Content-Type")) {
		_ = file.Close()
		flash.Set(w, h.secureCookie, "El archivo debe ser un PDF.")
		http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
		return
	}

	// Issue #197: the optional threshold fields resolve against the
	// control's stored pair (the form prefill), so a crafted POST that
	// omits one lands on the control's own pair, never on garbage.
	control, err := h.Service.Get(r.Context(), id)
	if err != nil {
		_ = file.Close()
		if errors.Is(err, controls.ErrControlNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
			return
		}
		h.Log.Error("upload: reading control for thresholds", "error", err, "id", id)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	ticked, unsure, ok := resolveThresholds(
		r.PostFormValue("ticked"), r.PostFormValue("unsure"), control)
	if !ok {
		_ = file.Close()
		flash.Set(w, h.secureCookie,
			"Los umbrales deben cumplir 0 < inseguro < marcado < 1.")
		http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
		return
	}

	save, err := h.Service.SaveUploadedBatch(r.Context(), controls.UploadRequest{
		ControlID: id,
		Filename:  header.Filename,
		Content:   file,
		Ticked:    ticked,
		Unsure:    unsure,
	})
	if err != nil {
		switch {
		case errors.Is(err, controls.ErrControlNotFound):
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		case errors.Is(err, controls.ErrAnalyzerRefused):
			// Only threshold validation reaches this branch on the sync
			// side — the actual worker call lives on the async job now.
			h.Log.Warn("controls: upload rejected", "control", id, "error", err)
			flash.Set(w, h.secureCookie,
				"Los umbrales deben cumplir 0 < inseguro < marcado < 1.")
			http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
		default:
			h.Log.Error("controls: save uploaded batch failed", "control", id, "error", err)
			middleware.WriteError(w, r, http.StatusInternalServerError,
				"El servidor no pudo guardar el escaneo. Vuelve a intentarlo en unos minutos.")
		}
		return
	}
	payload, err := json.Marshal(controls.AnalysePayload{
		BatchName: save.BatchName,
		Ticked:    save.Ticked,
		Unsure:    save.Unsure,
	})
	if err != nil {
		h.Log.Error("controls: encode analyse payload", "control", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"El servidor no pudo encolar el análisis.")
		return
	}
	if _, err := h.Runner.Submit(r.Context(), id, jobs.KindAnalyse, payload); err != nil {
		h.Log.Error("controls: submit analyse job", "control", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"El servidor no pudo encolar el análisis.")
		return
	}
	flash.Set(w, h.secureCookie,
		fmt.Sprintf("Escaneo %d subido. Análisis encolado — refresca cuando el aviso cambie.", save.BatchNumber))
	http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
}

// ReanalyzeScans handles POST /controls/:id/reanalyze. Reads
// ticked/unsure from the form (prefilled with the control's stored
// pair) and enqueues an async job for the runner (issue #249) rather
// than blocking the HTTP request. The professor is redirected to the
// detail page whose banner (Detail's JobBanner) surfaces the running
// job and the eventual done/failed state — no 502 from a slow proxy
// while the worker chews on the batch.
func (h *Controls) ReanalyzeScans(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !isValidControlID(id) {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return
	}
	if err := r.ParseForm(); err != nil {
		flash.Set(w, h.secureCookie, "No se pudo leer el formulario.")
		http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
		return
	}
	control, err := h.Service.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, controls.ErrControlNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
			return
		}
		h.Log.Error("reanalyze: reading control for thresholds", "error", err, "id", id)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	ticked, unsure, ok := resolveThresholds(
		r.PostFormValue("ticked"), r.PostFormValue("unsure"), control)
	if !ok {
		flash.Set(w, h.secureCookie,
			"Los umbrales deben cumplir 0 < inseguro < marcado < 1.")
		http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
		return
	}
	payload, err := json.Marshal(controls.ReanalysePayload{Ticked: ticked, Unsure: unsure})
	if err != nil {
		// Encoding two float64s does not fail in practice; the log line
		// is honest belt-and-braces so a change to the payload does not
		// pass unnoticed.
		h.Log.Error("reanalyze: encode payload", "control", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"El servidor no pudo encolar el trabajo.")
		return
	}
	if _, err := h.Runner.Submit(r.Context(), id, jobs.KindReanalyse, payload); err != nil {
		h.Log.Error("reanalyze: submit job", "control", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"El servidor no pudo encolar el trabajo.")
		return
	}
	flash.Set(w, h.secureCookie,
		fmt.Sprintf("Re-lectura encolada (marcado: %.2f, inseguro: %.2f). Refresca cuando el aviso cambie.", ticked, unsure))
	http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
}

// CloseCorrection handles POST /controls/:id/close.
func (h *Controls) CloseCorrection(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !isValidControlID(id) {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return
	}
	if err := h.Service.CloseCorrection(r.Context(), id); err != nil {
		switch {
		case errors.Is(err, controls.ErrControlNotFound):
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		case errors.Is(err, controls.ErrCloseBlocked):
			flash.Set(w, h.secureCookie,
				"No se puede cerrar todavía: aún hay copias sin resolver.")
			http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
		default:
			h.Log.Error("close correction", "control", id, "error", err)
			middleware.WriteError(w, r, http.StatusInternalServerError,
				"El servidor no pudo cerrar la corrección.")
		}
		return
	}
	// Issue #190: the hook fires AFTER the state committed as Graded — the
	// order is the contract, so a future integration can rely on reading a
	// graded control. A hook failure is logged and does not undo the close.
	if err := h.OnCorrectionClosed.Closed(r.Context(), id); err != nil {
		h.Log.Error("close correction: hook failed", "control", id, "error", err)
	}
	flash.Set(w, h.secureCookie, "Corrección cerrada.")
	http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
}

// UploadsPDF serves an uploaded scan batch from the shared volume
// (issue #204). The batch name comes from a URL segment, so the pattern
// above is the barrier: only the on-disk contract's shape can reach the
// file system. The control must exist (same list-then-serve pattern as
// servePDF); a batch that is not on disk is a 404.
func (h *Controls) UploadsPDF(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	batch := r.PathValue("batch")
	if !isValidControlID(id) {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return
	}
	// The domain owns the batch-naming contract (IsBatchName, the same
	// rule nextBatchNumber and UploadList use); a segment outside it never
	// reaches os.Open.
	if !controls.IsBatchName(batch) {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese archivo no existe.")
		return
	}
	if _, err := h.Service.Get(r.Context(), id); err != nil {
		if errors.Is(err, controls.ErrControlNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
			return
		}
		h.Log.Error("serving upload batch: reading control", "error", err, "id", id)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}

	path := h.Service.UploadPath(id, batch)
	f, err := os.Open(path)
	if err != nil {
		h.Log.Warn("serving upload batch", "id", id, "batch", batch, "error", err)
		middleware.WriteError(w, r, http.StatusNotFound,
			"Ese archivo no existe en el volumen compartido.")
		return
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		h.Log.Error("stat upload batch", "id", id, "batch", batch, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	// It is a download, not an embed: Content-Disposition attachment with
	// the stored batch name (the professor's original filename is not kept,
	// issue #204 §Non-goals).
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, batch))
	http.ServeContent(w, r, batch, info.ModTime(), f)
}

func parseFloatField(raw string, fallback float64) float64 {
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return fallback
	}
	return v
}

// looksLikePDF is a defensive check the professor sees a nice message
// against — the worker refuses non-PDFs itself.
func looksLikePDF(filename, contentType string) bool {
	if contentType == "application/pdf" {
		return true
	}
	// A missing content-type is common when the browser cannot infer one;
	// the filename is what saves the round trip. EqualFold catches .Pdf,
	// .PDF and friends.
	return strings.EqualFold(filepath.Ext(filename), ".pdf")
}
