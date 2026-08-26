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

// TestDirectoryListingIsNotServed guards against http.FileServerFS's default
// of rendering a browsable index of the embed. That would leak whatever else
// ends up under vendor/ over time.
func TestDirectoryListingIsNotServed(t *testing.T) {
	handler := static.Handler()

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/vendor/pdfjs/", nil))

	// 404 or 403 both count as "no listing"; a 200 with the file list is what
	// this case rules out.
	if rec.Code == http.StatusOK && strings.Contains(rec.Body.String(), "pdf.mjs") {
		t.Errorf("GET /vendor/pdfjs/ served a directory listing:\n%s", rec.Body.String())
	}
}
