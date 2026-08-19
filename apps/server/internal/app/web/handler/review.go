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
	// CopyAnnotatedPDF serves the corrected PDF (issue #190).
	CopyAnnotatedPDF = "/controls/{id}/copies/{copy}/annotated.pdf"
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
	// Issue #190: the corrected PDF replaces the raw scan once it exists.
	// The lookup failure is a 500 — same convention as the reading list on
	// the detail page: if the store is broken for this query, the page it
	// feeds cannot be trusted either.
	if _, exists, err := h.Service.AnnotatedFor(r.Context(), id, copyNumber); err != nil {
		h.Log.Error("review: annotated lookup", "error", err, "id", id, "copy", copyNumber)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	} else if exists {
		page.HasAnnotated = true
		page.AnnotatedURL = controlAnnotatedURL(id, copyNumber)
	}
	page.Flash = flash.Consume(w, r, h.secureCookie)
	if err := view.RenderReview(w, page); err != nil {
		h.Log.Error("rendering review", "error", err)
	}
}

// SaveReview handles POST /controls/:id/copies/:copy/review. Reads the
// form values, hands them to the Service, and flashes back to the detail
// page.
func (h *Controls) SaveReview(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	copyNumber, ok := parseCopyPathValue(r.PathValue("copy"))
	if !isValidControlID(id) || !ok {
		middleware.WriteError(w, r, http.StatusNotFound, "Esa página no existe.")
		return
	}
	if err := r.ParseForm(); err != nil {
		flash.Set(w, h.secureCookie, "No se pudo leer el formulario. Inténtalo de nuevo.")
		http.Redirect(w, r, controlReviewURL(id, copyNumber), http.StatusSeeOther)
		return
	}
	// Load the reading so we know which question refs live on it — the
	// form fields are named `q<ref>`, and enumerating them from the
	// reading avoids trusting the client with the set of refs.
	reading, err := h.Service.ReadingFor(r.Context(), id, copyNumber)
	if err != nil {
		if errors.Is(err, controls.ErrReadingNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound,
				"Aún no hay una lectura para esta copia. Sube el escaneo primero.")
			return
		}
		h.Log.Error("save review: reading", "error", err, "id", id, "copy", copyNumber)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}

	rut := strings.TrimSpace(r.PostFormValue("rut"))
	// SEC-1: the template's pattern="[0-9]{8}" is client-side; the
	// professor's form goes to the RUT override table verbatim, so an
	// arbitrary string would persist. Reject anything that is not eight
	// digits — the review handler is authenticated but a defensive server
	// check is cheap and stops the field from carrying garbage the rest
	// of the surface treats as an 8-digit id.
	if rut != "" && !isValidRUT(rut) {
		flash.Set(w, h.secureCookie, "El RUT debe tener 8 dígitos.")
		http.Redirect(w, r, controlReviewURL(id, copyNumber), http.StatusSeeOther)
		return
	}

	req := controls.SaveOverridesRequest{
		ControlID:  id,
		CopyNumber: copyNumber,
		RUT:        rut,
	}
	blank := r.PostFormValue("blank") // "" or one question_ref
	for _, a := range reading.Answers {
		edit := controls.AnswerEdit{QuestionRef: a.QuestionRef}
		if a.QuestionRef == blank {
			edit.Marked = nil
			edit.Status = controls.AnswerStatusBlank
		} else {
			field := "q" + a.QuestionRef
			values := r.PostForm[field]
			// SEC-2: cap the mark index at the answer's known alternative
			// count — the form was never generated with options past
			// a.Max, so anything higher is data pollution.
			maxMark := int(a.Max)
			if maxMark < 1 {
				maxMark = 26 // fallback cap (a professor cannot author more)
			}
			marks, err := parseAnswerValues(values, maxMark)
			if err != nil {
				flash.Set(w, h.secureCookie, "El formulario tiene un valor inválido.")
				http.Redirect(w, r, controlReviewURL(id, copyNumber), http.StatusSeeOther)
				return
			}
			edit.Marked = marks
			edit.Status = statusFor(marks, a.QuestionType)
		}
		req.Answers = append(req.Answers, edit)
	}

	if err := h.Service.SaveOverrides(r.Context(), req); err != nil {
		h.Log.Error("save review", "error", err, "id", id, "copy", copyNumber)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"El servidor no pudo guardar los cambios. Vuelve a intentarlo.")
		return
	}
	// Issue #190, ruta B: the save just changed what this copy means, so
	// the annotated PDF must follow — synchronously, inside the request
	// (the issue accepts the seconds-class block). A failure here does not
	// fail the save: the overrides are persisted and the next save retries
	// the annotate with the same payload.
	if _, err := h.Service.Annotate(r.Context(), id, copyNumber); err != nil {
		h.Log.Warn("save review: annotate failed", "control", id, "copy", copyNumber, "error", err)
	}
	if blank != "" {
		flash.Set(w, h.secureCookie, fmt.Sprintf("Pregunta %s marcada en blanco.", blank))
	} else {
		flash.Set(w, h.secureCookie, "Cambios guardados.")
	}
	http.Redirect(w, r, controlDetailURL(id), http.StatusSeeOther)
}

// parseAnswerValues turns form values ("1", "3") into an int slice,
// preserving the order the form submitted. Empty is legal (a blank
// answer). Anything above maxMark is refused — the form was never
// generated with those options.
func parseAnswerValues(values []string, maxMark int) ([]int, error) {
	if len(values) == 0 {
		return nil, nil
	}
	out := make([]int, 0, len(values))
	seen := map[int]bool{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return nil, fmt.Errorf("bad value %q", v)
		}
		if n > maxMark {
			return nil, fmt.Errorf("value %d exceeds this question's alternatives (%d)", n, maxMark)
		}
		if seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	return out, nil
}

// isValidRUT: exactly 8 digits. The check the client-side pattern
// makes, moved to the server so a hand-crafted POST cannot store
// arbitrary bytes in the RUT override table.
func isValidRUT(s string) bool {
	if len(s) != 8 {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// statusFor decides the AnswerStatus a saved edit lands at. For a simple
// question with more than one mark the professor has produced something
// impossible via the form — but leaving the branch in matches the report's
// own contract.
func statusFor(marks []int, qtype controls.QuestionType) controls.AnswerStatus {
	if len(marks) == 0 {
		return controls.AnswerStatusBlank
	}
	if qtype == controls.QuestionSimple && len(marks) > 1 {
		return controls.AnswerStatusAmbiguous
	}
	return controls.AnswerStatusOK
}

// PageImage serves the scanned page image for a copy. Path convention:
// <workdir>/controls/<id>/scans/copy-<copy>-page-<n>.png. This shape is
// part of the WORKER CONTRACT (ADR-0037) — the same class of promise
// as /generate's response paths — so a fallback engine has to satisfy
// the same names. The paper check (ADR-0030 §Not yet proven) is what
// pins the exact filename against real AMC output. Until then the
// endpoint answers 404 when the file is not on disk and the review
// page shows a broken-image icon rather than failing the whole page.
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
	// The extension follows whatever AMC's `getimages` produced: PNG for a
	// vector-sourced page, JPG for a raster-sourced scan. Miguel's first
	// real batch (2026-08-19) landed as JPG and this endpoint used to look
	// only for PNG, returning 404 for every real scan. PNG wins when both
	// exist so a future engine that produces both cannot silently flip
	// which image the reviewer sees. Content-Type mirrors the extension —
	// browsers accept both and the caller does not have to know.
	scansDir := filepath.Join(h.Service.ProjectDir(id), "scans")
	base := fmt.Sprintf("copy-%d-page-%d", copyNumber, pageNumber)
	for _, ext := range []string{".png", ".jpg"} {
		path := filepath.Join(scansDir, base+ext)
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		info, statErr := f.Stat()
		if statErr != nil {
			_ = f.Close()
			middleware.WriteError(w, r, http.StatusInternalServerError, "")
			return
		}
		defer func() { _ = f.Close() }()
		if ext == ".png" {
			w.Header().Set("Content-Type", "image/png")
		} else {
			w.Header().Set("Content-Type", "image/jpeg")
		}
		http.ServeContent(w, r, "page"+ext, info.ModTime(), f)
		return
	}
	middleware.WriteError(w, r, http.StatusNotFound, "La imagen escaneada no está disponible.")
}

// AnnotatedPDF serves the corrected PDF for one copy (issue #190). The
// annotated_copy row is the authority: no row, no PDF — the review page
// falls back to the raw scan and this endpoint answers 404.
func (h *Controls) AnnotatedPDF(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	copyNumber, ok := parseCopyPathValue(r.PathValue("copy"))
	if !isValidControlID(id) || !ok {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese archivo no existe.")
		return
	}
	if copyNumber > maxCopies {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese archivo no existe.")
		return
	}

	record, exists, err := h.Service.AnnotatedFor(r.Context(), id, copyNumber)
	if err != nil {
		h.Log.Error("serving annotated PDF", "error", err, "id", id, "copy", copyNumber)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	if !exists {
		middleware.WriteError(w, r, http.StatusNotFound,
			"El PDF corregido aún no existe para esta copia.")
		return
	}

	// The path is relative to the shared volume. Unlike SujetPath and
	// CorrigePath — which the server composes from a validated control id
	// — this one arrives from the worker's response through the database,
	// so the row lookup is NOT the whole boundary. The check below refuses
	// a record naming a path outside the work dir rather than serving it.
	path := filepath.Join(h.Service.WorkDir, filepath.FromSlash(record.Path))
	// The containment check is lexical: a symlink planted INSIDE the work
	// dir that points out of it would still resolve outside. That residual
	// is accepted defense-in-depth — the worker is the only writer of both
	// the volume and the response path, and it holds no auth either way —
	// but the check still closes the cheap class (a `..` record) without
	// trusting the database to only ever hold worker-shaped paths.
	if !withinDir(h.Service.WorkDir, path) {
		h.Log.Error("serving annotated PDF: record points outside the work dir",
			"id", id, "copy", copyNumber, "path", record.Path)
		middleware.WriteError(w, r, http.StatusNotFound,
			"El PDF corregido no está disponible.")
		return
	}
	f, err := os.Open(path)
	if err != nil {
		h.Log.Warn("serving annotated PDF", "id", id, "copy", copyNumber, "path", path, "error", err)
		middleware.WriteError(w, r, http.StatusNotFound,
			"El PDF corregido no está disponible. Puede que se haya limpiado del volumen compartido.")
		return
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		h.Log.Error("stat annotated PDF", "id", id, "copy", copyNumber, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`inline; filename="copia-%d-anotada.pdf"`, copyNumber))
	http.ServeContent(w, r, "annotated.pdf", info.ModTime(), f)
}

// withinDir reports whether path stays inside dir after cleaning. Both are
// absolute; the comparison is on the resolved relative form, so `..`
// segments are resolved rather than matched as text.
func withinDir(dir, path string) bool {
	rel, err := filepath.Rel(dir, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
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

// controlAnnotatedURL is the corrected PDF's URL (issue #190).
func controlAnnotatedURL(id string, copyNumber int) string {
	return fmt.Sprintf("%s/copies/%d/annotated.pdf", controlDetailURL(id), copyNumber)
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
		bq, hasBank := lookupQuestion(b, a.QuestionRef)
		q := view.ReviewQuestion{
			Index:        i + 1,
			QuestionRef:  a.QuestionRef,
			Statement:    statementOr(bq, hasBank, a.QuestionRef),
			Type:         string(a.QuestionType),
			Alternatives: alternativesFor(a, bq, hasBank),
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

// lookupQuestion resolves a bank ref through the O(1) FindQuestion added
// for WP-F. Returns hasBank=false when the bank is nil (test paths) or the
// ref is not authored — callers fall back to a generic label.
func lookupQuestion(b *bank.Bank, ref string) (bank.Question, bool) {
	if b == nil {
		return bank.Question{}, false
	}
	return b.FindQuestion(ref)
}

func statementOr(q bank.Question, has bool, ref string) string {
	if has {
		return q.Statement
	}
	return ref
}

func alternativesFor(a controls.Answer, q bank.Question, has bool) []view.ReviewAlternative {
	labels := q.Alternatives
	if !has {
		labels = nil
	}
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
