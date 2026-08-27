package handler

import (
	"errors"
	"net/http"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// Archive is the detail page's danger-zone POST target (issue #261). It
// soft-deletes the control and redirects to /controls with a flash. Any
// non-terminal async job in flight for this control keeps running:
// SoftDeleteControl only stamps deleted_at, and the runner (#249) is
// unaware of the column (§Async runner interaction).
//
// A repeat submission — the professor double-clicked, or reloaded a POST
// — hits SoftDeleteControl's idempotency guard and surfaces as
// ErrControlNotFound. That is not the same shape as a hand-typed URL for
// an id that never existed, but the redirect target is the same list, and
// the flash message is honest either way: "El control ya no está" reads
// as "gone from the active list" without claiming anything the second
// submission actually did or did not do.
func (h *Controls) Archive(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !isValidControlID(id) {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return
	}
	// A lookup before the write so the flash message can name the control
	// and the 404 path is distinguishable from a same-id repeat submission
	// on the log side.
	c, err := h.Service.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, controls.ErrControlNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
			return
		}
		h.Log.Error("archive: fetch", "id", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}

	if err := h.Service.Archive(r.Context(), id); err != nil {
		if errors.Is(err, controls.ErrControlNotFound) {
			// The row was archived by a parallel request between our Get
			// and here. Treat as success — the professor's intent was
			// "archive this", and it IS archived.
			flash.Set(w, h.secureCookie, "El control «"+c.Name+"» ya estaba archivado.")
			http.Redirect(w, r, ControlsPath, http.StatusSeeOther)
			return
		}
		h.Log.Error("archive", "id", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"No se pudo archivar el control.")
		return
	}
	flash.Set(w, h.secureCookie, "Control «"+c.Name+"» archivado. Podés restaurarlo desde el listado de archivados.")
	http.Redirect(w, r, ControlsPath, http.StatusSeeOther)
}

// Restore is the archived detail's banner and the archived-listing row's
// POST target (issue #261). It clears deleted_at and lands the professor
// on the restored control's detail page — the flash is on that page, not
// on /controls, so the professor sees the control they just brought
// back.
func (h *Controls) Restore(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !isValidControlID(id) {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return
	}
	c, err := h.Service.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, controls.ErrControlNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
			return
		}
		h.Log.Error("restore: fetch", "id", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}

	if err := h.Service.Restore(r.Context(), id); err != nil {
		if errors.Is(err, controls.ErrControlNotFound) {
			// Restore's guard: the row is already active. Treat as
			// success and land on the control anyway.
			flash.Set(w, h.secureCookie, "Este control ya estaba activo.")
			http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
			return
		}
		h.Log.Error("restore", "id", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"No se pudo restaurar el control.")
		return
	}
	flash.Set(w, h.secureCookie, "Control «"+c.Name+"» restaurado.")
	http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
}

// controlArchiveURL and controlRestoreURL are the two POST targets, used
// by the detail template and the archived list.
func controlArchiveURL(id string) string {
	return controlDetailURL(id) + "/archive"
}

func controlRestoreURL(id string) string {
	return controlDetailURL(id) + "/restore"
}
