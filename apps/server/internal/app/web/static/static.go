// Package static serves the backoffice's vendored front-end assets — today,
// PDF.js for the annotated-PDF viewer on the review page (issue #231). The
// files are embedded into the binary through //go:embed so the container is
// self-contained: no volume mount, no runtime download, no CSP allow-list
// for a CDN host.
//
// The subtree served is `vendor/`. Adding a new vendored library is a new
// subdirectory under vendor/ with its own README (see vendor/pdfjs/README.md
// for the shape) and one more entry on the embed line below.
package static

import (
	"embed"
	"net/http"
	"strings"
)

// Prefix is the URL prefix under which this handler's files are exposed.
// Exported so the router registers it and the template references it against
// one constant: renaming here breaks compilation everywhere the prefix
// mattered, rather than leaving the wrong URL in an HTML string.
const Prefix = "/static/"

//go:embed vendor/pdfjs/pdf.mjs vendor/pdfjs/pdf.worker.mjs vendor/pdfjs/LICENSE vendor/pdfjs/README.md
var files embed.FS

// Handler returns an http.Handler serving the embedded vendor tree, rooted so
// that a request to `/vendor/pdfjs/pdf.mjs` resolves to `vendor/pdfjs/pdf.mjs`
// inside the embed. The caller wraps it with http.StripPrefix if it mounts
// under a longer path (the router does — see Prefix).
//
// Requests for a directory (path ending in `/`, or a bare directory name
// http.FileServerFS would redirect and then list) are refused with 404 — a
// browsable index of the embed would leak whatever gets vendored here over
// time, which is not the surface this handler is offering.
func Handler() http.Handler {
	fileServer := http.FileServerFS(files)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}
