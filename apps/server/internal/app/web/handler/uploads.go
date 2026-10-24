package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strconv"

	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/uploads"
	"github.com/so77id/nalanda/apps/server/internal/infra/httpjson"
)

// A scan batch crosses a slow link in chunks (issue #339): the page creates
// an upload under its control or run, PUTs 1 MiB at a time here, asks the
// status after any error, and completes it under its subject again. These
// three routes are the subject-free half — an upload is addressed by its
// uid, and only its creator reaches it.
//
// They answer JSON, not pages: their reader is the page's script, which shows
// an error's `message` verbatim, so every message is Spanish and none
// carries an internal error (that goes to the log).

// UploadPath is one upload in progress: a chunk (PUT ?offset=N, the raw
// bytes), its status (GET) and Cancelar (DELETE).
const UploadPath = "/uploads/{uid}"

// Uploads serves the chunks of every upload, whatever it is for.
type Uploads struct {
	Service *uploads.Service
	Log     *slog.Logger
}

// NewUploads refuses a set of dependencies it cannot serve with, at boot.
func NewUploads(deps Uploads) *Uploads {
	switch {
	case deps.Service == nil:
		panic("handler.NewUploads: no uploads service")
	case deps.Log == nil:
		panic("handler.NewUploads: no logger")
	}
	return &deps
}

// What the page reads when a chunk route refuses. One not-found body for
// every kind of absence, so a uid cannot be probed.
const (
	uploadNotFound   = "Esa subida no existe: puede que ya haya terminado, que se haya cancelado o que pasara más de un día sin recibir datos."
	uploadBadOffset  = "La posición del pedazo no es válida."
	uploadOffsetOff  = "El servidor tiene otra parte del archivo; la subida sigue desde ahí."
	uploadChunkLarge = "Ese pedazo es más grande de lo que el servidor acepta."
	uploadPastSize   = "El archivo es más largo de lo que se anunció al empezar la subida."
	uploadChunkSlow  = "Ese pedazo tardó demasiado y se cortó; la subida sigue desde lo que llegó."
	uploadChunkCut   = "Ese pedazo llegó incompleto; la subida sigue desde lo que llegó."
	uploadBroke      = "Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos."
)

// Append writes one chunk. The body is raw bytes, so the CSRF token rides in
// the X-CSRF-Token header (middleware.VerifyCSRF).
func (h *Uploads) Append(w http.ResponseWriter, r *http.Request) {
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		writeUploadJSON(w, h.Log, http.StatusNotFound, uploadMessage{Message: uploadNotFound})
		return
	}
	id := r.PathValue("uid")
	offset, err := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	if err != nil || offset < 0 {
		writeUploadJSON(w, h.Log, http.StatusBadRequest, uploadMessage{Message: uploadBadOffset})
		return
	}
	// The declared length is checked before a byte is read, so an oversized
	// chunk writes nothing. MaxBytesReader is the belt for a body that
	// declares none: what it let through before refusing stays, like any cut
	// chunk's prefix (measured by removing this check: 1 MiB stayed).
	if r.ContentLength > uploads.ChunkBytes {
		writeUploadJSON(w, h.Log, http.StatusRequestEntityTooLarge, uploadMessage{Message: uploadChunkLarge})
		return
	}
	body := http.MaxBytesReader(w, r.Body, uploads.ChunkBytes)

	received, err := h.Service.Append(professor.ID, id, offset, body)
	var mismatch *uploads.OffsetMismatchError
	var tooBig *http.MaxBytesError
	switch {
	case err == nil:
		writeUploadJSON(w, h.Log, http.StatusOK, uploadProgress{Received: received})
	case errors.Is(err, uploads.ErrNotFound):
		writeUploadJSON(w, h.Log, http.StatusNotFound, uploadMessage{Message: uploadNotFound})
	case errors.As(err, &mismatch):
		writeUploadJSON(w, h.Log, http.StatusConflict, uploadRefusal{Message: uploadOffsetOff, Received: mismatch.Received})
	case errors.Is(err, uploads.ErrTooLarge):
		writeUploadJSON(w, h.Log, http.StatusRequestEntityTooLarge, uploadRefusal{Message: uploadPastSize, Received: received})
	case errors.As(err, &tooBig):
		writeUploadJSON(w, h.Log, http.StatusRequestEntityTooLarge, uploadRefusal{Message: uploadChunkLarge, Received: received})
	case errors.Is(err, uploads.ErrCut) && errors.Is(err, os.ErrDeadlineExceeded):
		// The read deadline cut the chunk. Its prefix stayed (uploads.Append),
		// and whether the page is still there to read this is its own matter.
		h.Log.Warn("upload chunk read timed out", "upload", id, "professor", professor.ID, "received", received)
		writeUploadJSON(w, h.Log, http.StatusRequestTimeout, uploadRefusal{Message: uploadChunkSlow, Received: received})
	case errors.Is(err, uploads.ErrCut):
		// The body failed part-way — the link dropped. Same as above.
		h.Log.Warn("upload chunk arrived cut", "upload", id, "professor", professor.ID, "received", received, "error", err)
		writeUploadJSON(w, h.Log, http.StatusBadRequest, uploadRefusal{Message: uploadChunkCut, Received: received})
	default:
		h.Log.Error("appending an upload chunk", "upload", id, "professor", professor.ID, "error", err)
		writeUploadJSON(w, h.Log, http.StatusInternalServerError, uploadMessage{Message: uploadBroke})
	}
}

// Status answers what the server holds — how the page resynchronises after
// any error.
func (h *Uploads) Status(w http.ResponseWriter, r *http.Request) {
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		writeUploadJSON(w, h.Log, http.StatusNotFound, uploadMessage{Message: uploadNotFound})
		return
	}
	id := r.PathValue("uid")
	up, err := h.Service.Status(professor.ID, id)
	switch {
	case err == nil:
		writeUploadJSON(w, h.Log, http.StatusOK, uploadStatus{Received: up.Received, Size: up.Size})
	case errors.Is(err, uploads.ErrNotFound):
		writeUploadJSON(w, h.Log, http.StatusNotFound, uploadMessage{Message: uploadNotFound})
	default:
		h.Log.Error("reading an upload's status", "upload", id, "professor", professor.ID, "error", err)
		writeUploadJSON(w, h.Log, http.StatusInternalServerError, uploadMessage{Message: uploadBroke})
	}
}

// Cancel removes the partial at once: the professor pressed Cancelar.
func (h *Uploads) Cancel(w http.ResponseWriter, r *http.Request) {
	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		writeUploadJSON(w, h.Log, http.StatusNotFound, uploadMessage{Message: uploadNotFound})
		return
	}
	id := r.PathValue("uid")
	err := h.Service.Remove(professor.ID, id)
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, uploads.ErrNotFound):
		writeUploadJSON(w, h.Log, http.StatusNotFound, uploadMessage{Message: uploadNotFound})
	default:
		h.Log.Error("cancelling an upload", "upload", id, "professor", professor.ID, "error", err)
		writeUploadJSON(w, h.Log, http.StatusInternalServerError, uploadMessage{Message: uploadBroke})
	}
}

// The JSON shapes the page reads. An error is always {"message"}, plus
// "received" when the page should resume from a number it was just told.
type (
	uploadMessage struct {
		Message string `json:"message"`
	}
	uploadRefusal struct {
		Message  string `json:"message"`
		Received int64  `json:"received"`
	}
	uploadProgress struct {
		Received int64 `json:"received"`
	}
	uploadStatus struct {
		Received int64 `json:"received"`
		Size     int64 `json:"size"`
	}
)

// writeUploadJSON answers the page's script. Never cached: a status served
// from a cache would resume an upload from a stale offset.
func writeUploadJSON(w http.ResponseWriter, log *slog.Logger, status int, value any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	httpjson.Write(w, log, status, value)
}
