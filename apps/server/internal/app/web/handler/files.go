package handler

import (
	"errors"
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/files"
)

// storeFailed is what a professor reads when the file store could not be
// read — S3 unreachable, refusing, or too slow — rather than the file
// being absent (issue #338 §8.5).
const storeFailed = "No se pudo leer el archivo del almacenamiento. Vuelve a intentarlo en unos segundos."

// resetSyncFailed is "Borrar escaneos" meeting a file store it could not
// keep in step, in either subsystem: whether S3 failed before the worker ran
// or after it, no reading was deleted, and a retry brings the scans back
// from S3 and finishes (issue #338).
const resetSyncFailed = "No se pudo sincronizar con S3; las lecturas no se borraron. Vuelve a intentarlo."

// fileUnavailable answers a work file that could not be opened. Absent (or
// a path the store refuses) is the page's own 404 with its own words; any
// other error is the store failing, which is not the file's absence — a 503
// that says so, and an error in the log with the SDK's words. Once the files
// live in S3 a network failure is ordinary, and "no está disponible" would
// send the professor looking for a file that is there.
func fileUnavailable(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error, missing string, attrs ...any) {
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, files.ErrInvalidPath) {
		log.Warn("work file not found", append(attrs, "error", err)...)
		middleware.WriteError(w, r, http.StatusNotFound, missing)
		return
	}
	log.Error("reading a work file", append(attrs, "error", err)...)
	middleware.WriteError(w, r, http.StatusServiceUnavailable, storeFailed)
}
