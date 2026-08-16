// Package httpjson writes JSON responses.
//
// It exists so the two delivery surfaces cannot drift apart on the mechanics of
// a response — the header, the order of the header-then-body writes — while
// staying free to disagree about content, which is the whole point of there
// being two of them.
package httpjson

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// Write encodes value as the body of a status response.
//
// The body is encoded BEFORE the header is written. Encoding straight into the
// ResponseWriter would commit the status code first, so a value that fails to
// marshal would arrive as a 200 with a truncated body — a broken response that
// reads as a successful one.
func Write(w http.ResponseWriter, logger *slog.Logger, status int, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		logger.Error("encoding a JSON response", "error", err)
		// Not http.Error: it sets text/plain plus nosniff, so the JSON body
		// below would go out under a content type the client is explicitly
		// told not to sniff — from the package whose whole purpose is that the
		// surfaces cannot drift on exactly this (#149 review, A5).
		status = http.StatusInternalServerError
		body = []byte(`{"error":"internal error"}`)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if _, err := w.Write(body); err != nil {
		// The status line is already out, so there is nothing to tell the
		// client; a dropped connection mid-body is normal and is logged rather
		// than escalated.
		logger.Debug("writing a JSON response body", "error", err)
	}
}
