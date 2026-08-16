package httpjson_test

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/infra/httpjson"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestWriteSendsTheStatusHeaderAndBody(t *testing.T) {
	rec := httptest.NewRecorder()

	httpjson.Write(rec, discardLogger(), http.StatusTeapot, map[string]string{"kind": "teapot"})

	if rec.Code != http.StatusTeapot {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusTeapot)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}
	if body := rec.Body.String(); body != `{"kind":"teapot"}` {
		t.Errorf("body = %q, want the encoded value", body)
	}
}

// The guard the package exists for. Encoding straight into the ResponseWriter
// commits the status line first, so a value that fails to marshal arrives as a
// 200 with a truncated body — a broken response that reads as a successful one.
// Here the failure must become a 500 instead.
func TestWriteReportsAnUnencodableValueAsAServerError(t *testing.T) {
	rec := httptest.NewRecorder()

	// A channel cannot be marshalled, and encoding/json only discovers that
	// once it is already walking the value.
	httpjson.Write(rec, discardLogger(), http.StatusOK, map[string]any{"bad": make(chan int)})

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d — the requested status must not be committed before the value encodes", rec.Code, http.StatusInternalServerError)
	}
}
