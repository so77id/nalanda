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

// controlPurgeURL is the POST target of the destructive step (S5).
func controlPurgeURL(id string) string {
	return controlDetailURL(id) + "/purge"
}

// PurgeConfirm renders the confirmation form (issue #261). The page is
// reachable ONLY from an archived control's row — an active control's id
// answers 404 rather than surfacing the button, keeping the defense-in-
// depth against a hand-typed URL from doing anything visible for an
// active row. The POST target re-validates the archived state anyway.
func (h *Controls) PurgeConfirm(w http.ResponseWriter, r *http.Request) {
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
		h.Log.Error("purge confirm: fetch", "id", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	if c.DeletedAt == nil {
		// A hand-typed URL for an active control. Refuse without
		// surfacing the destructive form.
		middleware.WriteError(w, r, http.StatusNotFound,
			"Ese control no está archivado. Archívalo primero desde su página de detalle.")
		return
	}
	h.renderPurgeConfirm(w, r, c, http.StatusOK, "", "")
}

// Purge is the destructive POST target (issue #261). Guards:
//  1. The URL id must be valid and the control must exist.
//  2. The control must be archived (belt over Service.Purge's own gate).
//  3. The form's `confirm_name` must EQUAL the stored name — verbatim,
//     no trim, no case-fold. A typo re-renders the confirmation page
//     with an inline error and keeps the row untouched.
//
// A successful purge lands on /controls/archived with a flash. Service.Purge
// handles cascade + best-effort file cleanup (§Design > Service.Purge).
func (h *Controls) Purge(w http.ResponseWriter, r *http.Request) {
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
		h.Log.Error("purge: fetch", "id", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	if c.DeletedAt == nil {
		middleware.WriteError(w, r, http.StatusNotFound,
			"Ese control no está archivado. Archívalo primero desde su página de detalle.")
		return
	}
	if err := r.ParseForm(); err != nil {
		h.renderPurgeConfirm(w, r, c, http.StatusBadRequest, "",
			"No se pudo leer el formulario. Inténtalo de nuevo.")
		return
	}
	typed := r.PostFormValue("confirm_name")
	if typed != c.Name {
		h.renderPurgeConfirm(w, r, c, http.StatusUnprocessableEntity, typed,
			"El nombre no coincide. Escribí el nombre exacto tal como aparece arriba.")
		return
	}

	if err := h.Service.Purge(r.Context(), id); err != nil {
		if errors.Is(err, controls.ErrCannotPurgeActive) {
			// Race: something restored the control between the fetch
			// above and this call. Re-render with a mismatch-shape
			// message so the professor sees why nothing happened.
			middleware.WriteError(w, r, http.StatusConflict,
				"El control fue restaurado en paralelo. Refrescá la lista.")
			return
		}
		if errors.Is(err, controls.ErrControlNotFound) {
			// Race: something purged it in parallel. The professor's
			// intent already succeeded elsewhere.
			flash.Set(w, h.secureCookie,
				"El control «"+c.Name+"» ya había sido eliminado.")
			http.Redirect(w, r, ControlsArchivedPath, http.StatusSeeOther)
			return
		}
		h.Log.Error("purge", "id", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"No se pudo eliminar el control.")
		return
	}
	flash.Set(w, h.secureCookie,
		"Control «"+c.Name+"» eliminado permanentemente.")
	http.Redirect(w, r, ControlsArchivedPath, http.StatusSeeOther)
}

// renderPurgeConfirm centralises the confirmation-page render (GET and
// the two POST refusal paths). Reuses toArchivedControls with a one-row
// slice so the row shape stays in one place (Round-A ARQ-1): a future
// field added to the archived listing lands on the confirmation page
// too, no drift.
func (h *Controls) renderPurgeConfirm(w http.ResponseWriter, r *http.Request, c controls.Control, status int, typed, mismatch string) {
	rows := h.toArchivedControls([]controls.Control{c})
	page := view.ControlPurgeConfirmPage{
		Page:         middleware.PageFor(r, "Eliminar "+c.Name),
		Control:      rows[0],
		PurgeURL:     controlPurgeURL(c.ID),
		NameMismatch: mismatch,
		Typed:        typed,
	}
	if err := view.RenderControlPurgeConfirm(w, status, page); err != nil {
		h.Log.Error("rendering the purge confirmation page", "error", err)
	}
}
