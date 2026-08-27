package handler

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
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

// Archived renders /controls/archived (issue #261). Same shape as List
// with the added Restore button per row and the "Eliminar
// permanentemente" link that opens the S5 confirmation page. Ordered by
// deleted_at DESC (Service.ArchivedList → Store.ListArchivedControls).
func (h *Controls) Archived(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Service.ArchivedList(r.Context())
	if err != nil {
		h.Log.Error("listing archived controls", "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}

	page := view.ControlsArchivedPage{
		Page:     middleware.PageFor(r, "Controles archivados"),
		Controls: h.toArchivedControls(rows),
	}
	page.Flash = flash.Consume(w, r, h.secureCookie)

	if err := view.RenderControlsArchived(w, page); err != nil {
		h.Log.Error("rendering the archived-controls list", "error", err)
	}
}

// toArchivedControls turns domain values into the rows the archived
// template renders. Same pre-formatted shape as toListedControls plus the
// per-row action URLs (restore, purge-confirm).
func (h *Controls) toArchivedControls(rows []controls.Control) []view.ArchivedControl {
	out := make([]view.ArchivedControl, 0, len(rows))
	b := h.Bank.Get()
	for _, c := range rows {
		archivedAt := ""
		if c.DeletedAt != nil {
			archivedAt = spanishDate(*c.DeletedAt)
		}
		out = append(out, view.ArchivedControl{
			ID:              c.ID,
			Name:            c.Name,
			ApplicationDate: formatOptionalDate(c.ApplicationDate),
			Range:           formatRangeWithTitles(c.RangeFrom, c.RangeTo, b),
			Shape:           fmt.Sprintf("%d preguntas × %d copias", c.QuestionsPerCopy, c.Copies),
			State:           stateWordControl(c.State),
			ArchivedAt:      archivedAt,
			DetailURL:       controlDetailURL(c.ID),
			RestoreURL:      controlRestoreURL(c.ID),
			PurgeConfirmURL: controlPurgeConfirmURL(c.ID),
		})
	}
	return out
}

// controlArchiveURL and controlRestoreURL are the two POST targets, used
// by the detail template and the archived list.
func controlArchiveURL(id string) string {
	return controlDetailURL(id) + "/archive"
}

func controlRestoreURL(id string) string {
	return controlDetailURL(id) + "/restore"
}

// controlPurgeConfirmURL is the GET target of the confirmation page (S5).
func controlPurgeConfirmURL(id string) string {
	return controlDetailURL(id) + "/purge/confirm"
}
