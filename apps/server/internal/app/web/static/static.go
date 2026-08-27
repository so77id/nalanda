// Package static serves the backoffice's vendored front-end assets — today,
// PDF.js for the annotated-PDF viewer on the review page (issue #231). The
// files are embedded into the binary through //go:embed so the container is
// self-contained: no volume mount, no runtime download, no CSP allow-list
// for a CDN host.
//
// The URL space this handler owns is decided by the router — router.go picks
// the mount point and http.StripPrefixes matching requests before they reach
// Handler(). The on-disk root is `vendor/` (see the embed line below).
//
// Adding a new vendored library is a new subdirectory under vendor/ with its
// own README (see vendor/pdfjs/README.md for the shape) and one more entry on
// the embed line below. The explicit file list is deliberate: `all:vendor`
// would silently ship every companion file that lands beside the library
// (`.map`, `.sandbox.mjs`, translation JSON), which is exactly the surface
// the vendor step exists to keep narrow.
package static

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed vendor/pdfjs/pdf.mjs vendor/pdfjs/pdf.worker.mjs vendor/pdfjs/LICENSE vendor/pdfjs/README.md
var files embed.FS

// Handler returns an http.Handler serving the embedded vendor tree, rooted so
// that a request to `/vendor/pdfjs/pdf.mjs` resolves to `vendor/pdfjs/pdf.mjs`
// inside the embed. The caller wraps it with http.StripPrefix if it mounts
// under a longer path (the router does).
//
// A request for a directory — a trailing-slash path OR a bare directory
// name http.FileServerFS would redirect to its trailing-slash form — is
// refused with 404. A browsable index of the embed would leak whatever gets
// vendored here over time, and the redirect on the bare-name shape alone
// (Go's default) still confirms directory existence to a probe. This
// handler answers both cases the same way.
func Handler() http.Handler {
	fileServer := http.FileServerFS(files)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/") || isDirectory(r.URL.Path) {
			http.NotFound(w, r)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

// isDirectory reports whether the requested path names a directory inside
// the embed. Called ONLY on the bare-name shape (no trailing slash), so the
// leading slash of a URL path is stripped before the lookup — embed.FS uses
// relative POSIX paths.
func isDirectory(urlPath string) bool {
	trimmed := strings.TrimPrefix(urlPath, "/")
	if trimmed == "" {
		return true
	}
	info, err := fs.Stat(files, trimmed)
	return err == nil && info.IsDir()
}
