package handler

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// The review routes.
const (
	CopyReviewPath = "/controls/{id}/copies/{copy}/review"
	CopyPageImage  = "/controls/{id}/copies/{copy}/page/{n}"
)

// Review renders the split-view page for one copy: the scanned image on
// the left, the editable form on the right.
func (h *Controls) Review(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	copyNumber, ok := parseCopyPathValue(r.PathValue("copy"))
	if !isValidControlID(id) || !ok {
		middleware.WriteError(w, r, http.StatusNotFound, "Esa página no existe.")
		return
	}
	control, err := h.Service.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, controls.ErrControlNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
			return
		}
		h.Log.Error("review: reading control", "error", err, "id", id)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	reading, err := h.Service.ReadingFor(r.Context(), id, copyNumber)
	if err != nil {
		if errors.Is(err, controls.ErrReadingNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound,
				"Aún no hay una lectura para esta copia. Sube el escaneo primero.")
			return
		}
		h.Log.Error("review: reading not found", "error", err, "id", id, "copy", copyNumber)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}

	page := view.ReviewPage{
		Page:       middleware.PageFor(r, fmt.Sprintf("Copia %d", copyNumber)),
		ControlID:  id,
		Name:       control.Name,
		CopyNumber: copyNumber,
		BackURL:    controlDetailURL(id),
		ImageURL:   controlPageImageURL(id, copyNumber, 1),
		SaveURL:    controlReviewURL(id, copyNumber),
		Graded:     control.State == controls.Graded,
		RUT:        toReviewRUT(reading),
		Questions:  toReviewQuestions(reading, h.Bank),
	}
	page.Flash = flash.Consume(w, r, h.secureCookie)
	if err := view.RenderReview(w, page); err != nil {
		h.Log.Error("rendering review", "error", err)
	}
}

// PageImage serves the scanned page image for a copy. Path convention:
// <workdir>/controls/<id>/scans/copy-<copy>-page-<n>.png. The naming is a
// MODEL of what apps/amc-worker's getimages produces — the WP-F ADR-0031
// note about "we depend on the engine's private storage" applies here
// too. When the file is not on disk (which happens today because the
// worker's actual naming is not yet pinned), the endpoint answers 404 and
// the review page shows a broken-image icon rather than failing the
// whole page.
func (h *Controls) PageImage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	copyNumber, okCopy := parseCopyPathValue(r.PathValue("copy"))
	pageNumber, okPage := parseCopyPathValue(r.PathValue("n"))
	if !isValidControlID(id) || !okCopy || !okPage {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese archivo no existe.")
		return
	}
	// Bound the sanity check: absolutely never a 3-digit page number here,
	// and never a copy number above the config max. Same reason the
	// review page number lives in a path segment: the mux does not know.
	if pageNumber < 1 || pageNumber > 99 || copyNumber < 1 || copyNumber > maxCopies {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese archivo no existe.")
		return
	}
	// The lookup ensures the row is real — a scan image for a
	// non-existent control never resolves.
	if _, err := h.Service.Get(r.Context(), id); err != nil {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return
	}
	path := filepath.Join(h.Service.ProjectDir(id), "scans",
		fmt.Sprintf("copy-%d-page-%d.png", copyNumber, pageNumber))
	f, err := os.Open(path)
	if err != nil {
		middleware.WriteError(w, r, http.StatusNotFound, "La imagen escaneada no está disponible.")
		return
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		middleware.WriteError(w, r, http.StatusInternalServerError, "")
		return
	}
	w.Header().Set("Content-Type", "image/png")
	http.ServeContent(w, r, "page.png", info.ModTime(), f)
}

// parseCopyPathValue turns a path segment into a positive int. Empty and
// negative reject.
func parseCopyPathValue(raw string) (int, bool) {
	if raw == "" {
		return 0, false
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 0, false
	}
	return n, true
}

func controlPageImageURL(id string, copyNumber, pageNumber int) string {
	return fmt.Sprintf("%s/copies/%d/page/%d", controlDetailURL(id), copyNumber, pageNumber)
}

func toReviewRUT(r controls.Reading) view.ReviewRUT {
	rut := view.ReviewRUT{
		Status:  string(r.RUTStatus),
		WasRead: r.RUTRead != nil,
	}
	if r.RUTOverride != nil {
		rut.Value = r.RUTOverride.RUT
		rut.Overridden = true
	} else if r.RUTRead != nil {
		rut.Value = *r.RUTRead
	}
	if r.RUTRead != nil {
		rut.OriginalRead = *r.RUTRead
	}
	return rut
}

func toReviewQuestions(r controls.Reading, b *bank.Bank) []view.ReviewQuestion {
	out := make([]view.ReviewQuestion, 0, len(r.Answers))
	for i, a := range r.Answers {
		q := view.ReviewQuestion{
			Index:        i + 1,
			QuestionRef:  a.QuestionRef,
			Statement:    lookupStatement(b, a.QuestionRef),
			Type:         string(a.QuestionType),
			Alternatives: alternativesFor(a, lookupAlternatives(b, a.QuestionRef)),
			OriginalRead: originalReadLabel(a),
		}
		if a.Override != nil {
			q.Overridden = true
			q.Selected = a.Override.Marked
			q.Status = string(a.Override.Status)
		} else {
			q.Selected = a.Marked
			q.Status = string(a.Status)
		}
		out = append(out, q)
	}
	return out
}

func alternativesFor(a controls.Answer, labels []string) []view.ReviewAlternative {
	// If we have no bank info, still render one option per marked slot so
	// the form remains editable.
	max := len(labels)
	if max == 0 {
		max = int(a.Max)
	}
	if max == 0 {
		max = 4 // sensible default; a professor can still edit
	}
	out := make([]view.ReviewAlternative, max)
	for i := 0; i < max; i++ {
		label := fmt.Sprintf("Opción %d", i+1)
		if i < len(labels) {
			label = labels[i]
		}
		out[i] = view.ReviewAlternative{Index: i + 1, Label: label}
	}
	return out
}

func lookupStatement(b *bank.Bank, ref string) string {
	if b == nil {
		return ref
	}
	for _, q := range b.Questions {
		if q.ID == ref {
			return q.Statement
		}
	}
	return ref
}

func lookupAlternatives(b *bank.Bank, ref string) []string {
	if b == nil {
		return nil
	}
	for _, q := range b.Questions {
		if q.ID == ref {
			return q.Alternatives
		}
	}
	return nil
}

func originalReadLabel(a controls.Answer) string {
	if a.Override == nil {
		return ""
	}
	// "AMC leyó: 2" or "AMC leyó: 1,3" or "AMC leyó: —"
	if len(a.Marked) == 0 {
		return "AMC leyó: —"
	}
	parts := make([]string, len(a.Marked))
	for i, m := range a.Marked {
		parts[i] = strconv.Itoa(m)
	}
	return "AMC leyó: " + strings.Join(parts, ",")
}
