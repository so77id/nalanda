package handler

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// ControlScansPath is POST target for the upload form on /controls/:id.
const ControlScansPath = "/controls/{id}/scans"

// ControlReanalyzePath is POST target for the "re-leer con otra
// sensibilidad" form.
const ControlReanalyzePath = "/controls/{id}/reanalyze"

// ControlClosePath is POST target for "Cerrar corrección" (S8).
const ControlClosePath = "/controls/{id}/close"

// Defaults for the reanalyze form, mirroring apps/amc-worker.
const (
	defaultTicked = 0.30
	defaultUnsure = 0.10
)

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

	result, err := h.Service.UploadScan(r.Context(), controls.UploadRequest{
		ControlID: id,
		Filename:  header.Filename,
		Content:   file,
	})
	if err != nil {
		switch {
		case errors.Is(err, controls.ErrControlNotFound):
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		case errors.Is(err, controls.ErrAnalyzerRefused):
			h.Log.Warn("controls: worker refused scan", "control", id, "error", err)
			flash.Set(w, h.secureCookie,
				"El motor de lectura rechazó el archivo. Revisa que sea un escaneo del control correcto.")
			http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
		case errors.Is(err, controls.ErrAnalyzerUnavailable):
			h.Log.Error("controls: worker unreachable", "control", id, "error", err)
			middleware.WriteError(w, r, http.StatusInternalServerError,
				"El motor de lectura no está disponible. Vuelve a intentarlo en unos minutos; si el problema persiste, avisa a infraestructura.")
		default:
			h.Log.Error("controls: upload failed", "control", id, "error", err)
			middleware.WriteError(w, r, http.StatusInternalServerError,
				"El servidor no pudo procesar el escaneo. Vuelve a intentarlo en unos minutos.")
		}
		return
	}

	flash.Set(w, h.secureCookie,
		fmt.Sprintf("Escaneo %d procesado (%d copias leídas).", result.BatchNumber, len(result.Report.Copies)))
	http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
}

// ReanalyzeScans handles POST /controls/:id/reanalyze. Reads ticked/unsure
// from the form (defaults if empty), asks the Service to re-read the
// captured project at those thresholds, and redirects to detail with a
// flash.
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
	ticked := parseFloatField(r.PostFormValue("ticked"), defaultTicked)
	unsure := parseFloatField(r.PostFormValue("unsure"), defaultUnsure)
	if ticked <= 0 || ticked >= 1 || unsure < 0 || unsure >= ticked {
		flash.Set(w, h.secureCookie,
			"Los umbrales deben cumplir 0 < inseguro < marcado < 1.")
		http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
		return
	}
	if _, err := h.Service.Reanalyze(r.Context(), id, ticked, unsure); err != nil {
		switch {
		case errors.Is(err, controls.ErrControlNotFound):
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		case errors.Is(err, controls.ErrAnalyzerRefused):
			h.Log.Warn("controls: worker refused reanalyze", "control", id, "error", err)
			flash.Set(w, h.secureCookie,
				"El motor rechazó re-leer. Puede que aún no haya escaneos subidos.")
			http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
		case errors.Is(err, controls.ErrAnalyzerUnavailable):
			h.Log.Error("controls: worker unreachable during reanalyze", "control", id, "error", err)
			middleware.WriteError(w, r, http.StatusInternalServerError,
				"El motor no está disponible. Vuelve a intentarlo en unos minutos.")
		default:
			h.Log.Error("controls: reanalyze failed", "control", id, "error", err)
			middleware.WriteError(w, r, http.StatusInternalServerError,
				"El servidor no pudo re-leer el lote.")
		}
		return
	}
	flash.Set(w, h.secureCookie,
		fmt.Sprintf("Lote re-leído (marcado: %.2f, inseguro: %.2f).", ticked, unsure))
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
	flash.Set(w, h.secureCookie, "Corrección cerrada.")
	http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
}

func parseFloatField(raw string, fallback float64) float64 {
	if raw == "" {
		return fallback
	}
	var v float64
	if _, err := fmt.Sscanf(raw, "%f", &v); err != nil {
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
	// the filename is what saves the round trip.
	n := len(filename)
	return n >= 4 && (filename[n-4:] == ".pdf" || filename[n-4:] == ".PDF")
}
