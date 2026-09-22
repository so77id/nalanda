package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
)

// "Borrar escaneos y empezar de nuevo" (issue #298 §E): the destructive-
// confirm pair of add-a-backend-endpoint.md, on the Escaneos box. The
// precondition is "the control has scans"; a control with nothing to lose
// answers 404 on both URLs, so the form never renders for it.
const (
	ControlScansResetConfirmPath = "/controls/{id}/scans/reset/confirm"
	ControlScansResetPath        = "/controls/{id}/scans/reset"
)

// scansResetDeadline bounds the synchronous reset, under httpserver's 30 s
// write timeout — same reasoning as copyPublishDeadline: Go's write
// deadline neither aborts a handler nor cancels r.Context().
//
// SYNCHRONOUS ON PURPOSE, against the "an AMC-worker call is async"
// rule: the worker only removes files, which is bounded, and the
// professor is waiting to know whether the scans are gone. ScansReset
// refuses while a job is in flight, so the worker's AMC lock is free
// and the call does not queue behind a minutes-class analyse.
const scansResetDeadline = 25 * time.Second

func controlScansResetConfirmURL(id string) string {
	return controlDetailURL(id) + "/scans/reset/confirm"
}

func controlScansResetURL(id string) string {
	return controlDetailURL(id) + "/scans/reset"
}

// ScansResetConfirm renders the confirmation page: what the reset
// destroys, and the field that must hold the control's name verbatim.
func (h *Controls) ScansResetConfirm(w http.ResponseWriter, r *http.Request) {
	c, summary, ok := h.scansResetTarget(w, r)
	if !ok {
		return
	}
	h.renderScansResetConfirm(w, r, c, summary, http.StatusOK, "", "")
}

// ScansReset is the destructive POST. Gates, in order: the control exists,
// is active and has scans (404 otherwise, same as the GET); no job is in
// flight (409); the typed name equals the stored one verbatim (422 with
// the value echoed back). Then Service.ResetScans: worker first, database
// after.
func (h *Controls) ScansReset(w http.ResponseWriter, r *http.Request) {
	c, summary, ok := h.scansResetTarget(w, r)
	if !ok {
		return
	}
	if job, err := h.Jobs.LatestForControl(r.Context(), c.ID); err == nil && !job.Status.IsTerminal() {
		middleware.WriteError(w, r, http.StatusConflict,
			"Hay un trabajo en curso sobre este control. Espera a que termine y vuelve a intentarlo.")
		return
	} else if err != nil && !errors.Is(err, jobs.ErrJobNotFound) {
		h.Log.Error("scans reset: reading jobs", "id", c.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. No se borró nada.")
		return
	}
	if err := r.ParseForm(); err != nil {
		h.renderScansResetConfirm(w, r, c, summary, http.StatusBadRequest, "",
			"No se pudo leer el formulario. Inténtalo de nuevo.")
		return
	}
	typed := r.PostFormValue("confirm_name")
	if typed != c.Name {
		h.renderScansResetConfirm(w, r, c, summary, http.StatusUnprocessableEntity, typed,
			"El nombre no coincide. Escribe el nombre exacto tal como aparece arriba.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), scansResetDeadline)
	defer cancel()
	if err := h.Service.ResetScans(ctx, c.ID); err != nil {
		switch {
		case errors.Is(err, controls.ErrNoScans):
			middleware.WriteError(w, r, http.StatusNotFound, "Este control no tiene escaneos.")
		case errors.Is(err, controls.ErrAnalyzerRefused), errors.Is(err, controls.ErrAnalyzerUnavailable),
			errors.Is(err, context.DeadlineExceeded):
			h.Log.Error("scans reset: worker", "id", c.ID, "error", err)
			middleware.WriteError(w, r, http.StatusBadGateway,
				"El motor de lectura no pudo borrar los escaneos; no se borró nada. Vuelve a intentarlo en unos minutos.")
		default:
			// Past the worker: its files are gone and the database write
			// failed. Say so rather than "nothing was deleted".
			h.Log.Error("scans reset: database", "id", c.ID, "error", err)
			middleware.WriteError(w, r, http.StatusInternalServerError,
				"Se borraron los archivos de escaneo pero no las lecturas. Vuelve a intentarlo para terminar.")
		}
		return
	}
	flash.Set(w, h.secureCookie,
		"Escaneos de «"+c.Name+"» borrados. El control quedó como recién generado.")
	http.Redirect(w, r, controlDetailURL(c.ID), http.StatusSeeOther)
}

// scansResetTarget resolves the control both routes act on and applies the
// shared 404 precondition. Writes the error response itself; ok=false means
// the caller returns.
func (h *Controls) scansResetTarget(w http.ResponseWriter, r *http.Request) (controls.Control, controls.ScanSummary, bool) {
	id := r.PathValue("id")
	if !isValidControlID(id) {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return controls.Control{}, controls.ScanSummary{}, false
	}
	c, err := h.Service.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, controls.ErrControlNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
			return controls.Control{}, controls.ScanSummary{}, false
		}
		h.Log.Error("scans reset: fetch", "id", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return controls.Control{}, controls.ScanSummary{}, false
	}
	if c.DeletedAt != nil {
		middleware.WriteError(w, r, http.StatusNotFound,
			"Ese control está archivado. Restáuralo antes de borrar sus escaneos.")
		return controls.Control{}, controls.ScanSummary{}, false
	}
	summary, err := h.Service.ScanSummaryFor(r.Context(), c.ID)
	if err != nil {
		h.Log.Error("scans reset: summary", "id", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return controls.Control{}, controls.ScanSummary{}, false
	}
	if !summary.HasScans() {
		middleware.WriteError(w, r, http.StatusNotFound, "Este control no tiene escaneos.")
		return controls.Control{}, controls.ScanSummary{}, false
	}
	return c, summary, true
}

func (h *Controls) renderScansResetConfirm(w http.ResponseWriter, r *http.Request, c controls.Control, s controls.ScanSummary, status int, typed, mismatch string) {
	page := view.ControlScansResetConfirmPage{
		Page:         middleware.PageFor(r, "Borrar escaneos de "+c.Name),
		Name:         c.Name,
		DetailURL:    controlDetailURL(c.ID),
		ResetURL:     controlScansResetURL(c.ID),
		Uploads:      countPhrase(s.Uploads, "1 lote subido", "%d lotes subidos"),
		Read:         countPhrase(s.Read, "1 copia leída", "%d copias leídas"),
		Published:    s.Published,
		PublishedTxt: countPhrase(s.Published, "1 copia ya publicada", "%d copias ya publicadas"),
		CorrectedTxt: countPhrase(s.Corrected, "1 copia con correcciones a mano", "%d copias con correcciones a mano"),
		NameMismatch: mismatch,
		Typed:        typed,
	}
	if err := view.RenderControlScansResetConfirm(w, status, page); err != nil {
		h.Log.Error("rendering the scans reset confirmation page", "error", err)
	}
}

// countPhrase is the page's number agreement: the singular sentence, or
// the plural one with the count.
func countPhrase(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return fmt.Sprintf(many, n)
}
