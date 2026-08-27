package static_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/static"
)

// TestPDFJSIsServedFromTheVendorSubtree pins the two files the review page
// loads (issue #231). If either drops out of the embed, the vendor script
// tag in the template 404s and the annotated-PDF viewer never boots — a
// failure the JS-blind unit tests around the template markup cannot see.
func TestPDFJSIsServedFromTheVendorSubtree(t *testing.T) {
	handler := static.Handler()

	cases := []struct {
		path         string
		wantSubstr   string // a token that proves it's the right file
		wantCTPrefix string
	}{
		{
			path:         "/vendor/pdfjs/pdf.mjs",
			wantSubstr:   "Mozilla Foundation",
			wantCTPrefix: "text/javascript",
		},
		{
			path:         "/vendor/pdfjs/pdf.worker.mjs",
			wantSubstr:   "Mozilla Foundation",
			wantCTPrefix: "text/javascript",
		},
	}

	for _, c := range cases {
		t.Run(c.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, c.path, nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("GET %s = %d, want 200\n%s", c.path, rec.Code, rec.Body.String())
			}
			ct := rec.Header().Get("Content-Type")
			if !strings.HasPrefix(ct, c.wantCTPrefix) {
				t.Errorf("Content-Type = %q, want prefix %q — a browser importing an ES module refuses a non-JS MIME type",
					ct, c.wantCTPrefix)
			}
			body, err := io.ReadAll(rec.Body)
			if err != nil {
				t.Fatalf("reading body: %v", err)
			}
			if !strings.Contains(string(body), c.wantSubstr) {
				t.Errorf("body missing %q — file may be wrong or truncated (got %d bytes)",
					c.wantSubstr, len(body))
			}
		})
	}
}

// TestUnknownPathAnswers404 keeps the handler honest: a missing file is a
// 404, not a 200 with an empty body or a directory index.
func TestUnknownPathAnswers404(t *testing.T) {
	handler := static.Handler()

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/vendor/pdfjs/does-not-exist.mjs", nil))

	if rec.Code != http.StatusNotFound {
		t.Errorf("GET a missing file = %d, want 404", rec.Code)
	}
}

// TestDirectoryRequestsAnswer404 guards against http.FileServerFS's defaults:
// (a) rendering a browsable index at a trailing-slash path, (b) 301-redirecting
// a bare directory name to the trailing-slash form (which still confirms the
// directory exists to a probe). Both shapes must answer 404, and the body must
// carry no href a listing would contain — removing the guard in Handler() has
// to fail this test rather than pass because the substring "pdf.mjs" happens
// not to appear in a listing after some future rearrangement.
func TestDirectoryRequestsAnswer404(t *testing.T) {
	handler := static.Handler()

	cases := []string{
		"/vendor/pdfjs/", // trailing-slash shape
		"/vendor/pdfjs",  // bare directory name — Go's default is a 301
		"/vendor/",       // one level up, same shapes
		"/vendor",        //
	}
	for _, path := range cases {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

			if rec.Code != http.StatusNotFound {
				t.Errorf("GET %s = %d, want 404 — a directory request must not "+
					"return a listing (200) or a redirect (301)", path, rec.Code)
			}
			if strings.Contains(rec.Body.String(), "<a href=") {
				t.Errorf("GET %s body carries a link, which a directory listing "+
					"would; the guard has drifted:\n%s", path, rec.Body.String())
			}
		})
	}
}
