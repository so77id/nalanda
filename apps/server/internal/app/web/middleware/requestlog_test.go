package middleware_test

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
)

// captureLogs returns a JSON slog handler writing into buf, at DEBUG level so a
// /health line is visible when the case asserts it was demoted.
func captureLogs(buf *bytes.Buffer) *slog.Logger {
	return slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

// TestRequestLogEmitsOneLinePerRequest is the happy path: a 200 leaves one INFO
// line carrying method, path, status, bytes and a non-negative duration_ms.
func TestRequestLogEmitsOneLinePerRequest(t *testing.T) {
	buf := &bytes.Buffer{}
	logger := captureLogs(buf)
	wrapped := middleware.RequestLog(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("hola"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/controls", nil)
	wrapped.ServeHTTP(httptest.NewRecorder(), req)

	line := decodeOneLine(t, buf)
	if got, want := line["level"], "INFO"; got != want {
		t.Errorf("level: got %q, want %q", got, want)
	}
	if got, want := line["msg"], "request"; got != want {
		t.Errorf("msg: got %q, want %q", got, want)
	}
	if got, want := line["method"], http.MethodGet; got != want {
		t.Errorf("method: got %q, want %q", got, want)
	}
	if got, want := line["path"], "/controls"; got != want {
		t.Errorf("path: got %q, want %q", got, want)
	}
	if got, want := jsonNumberInt(t, line["status"]), 200; got != want {
		t.Errorf("status: got %d, want %d", got, want)
	}
	if got, want := jsonNumberInt(t, line["bytes"]), 4; got != want {
		t.Errorf("bytes: got %d, want %d", got, want)
	}
	if _, ok := line["duration_ms"]; !ok {
		t.Errorf("duration_ms: missing")
	}
}

// TestRequestLogCapturesStatusFromWriteHeader pins that a 500 the handler chose
// reaches the log, so a bug report of "no persisted / no flash" can be matched
// to the actual status the server sent.
func TestRequestLogCapturesStatusFromWriteHeader(t *testing.T) {
	buf := &bytes.Buffer{}
	logger := captureLogs(buf)
	wrapped := middleware.RequestLog(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))

	wrapped.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/controls/1/copies/2/review", nil))

	line := decodeOneLine(t, buf)
	if got, want := jsonNumberInt(t, line["status"]), http.StatusInternalServerError; got != want {
		t.Errorf("status: got %d, want %d", got, want)
	}
}

// TestRequestLogCapturesStatusFromRedirect pins a 302: the login redirect is
// the single most common non-200 in production, and losing it in the log would
// mean every anonymous request looked like a served page.
func TestRequestLogCapturesStatusFromRedirect(t *testing.T) {
	buf := &bytes.Buffer{}
	logger := captureLogs(buf)
	wrapped := middleware.RequestLog(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
	}))

	wrapped.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/controls", nil))

	line := decodeOneLine(t, buf)
	if got, want := jsonNumberInt(t, line["status"]), http.StatusSeeOther; got != want {
		t.Errorf("status: got %d, want %d", got, want)
	}
}

// TestRequestLogPreservesQueryString pins that ?copy=2 stays in the log — the
// backoffice's review page is /controls/{id}/copies/{copy}/review AND takes
// query params, and a bug report often points at exactly one of them.
func TestRequestLogPreservesQueryString(t *testing.T) {
	buf := &bytes.Buffer{}
	logger := captureLogs(buf)
	wrapped := middleware.RequestLog(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	wrapped.ServeHTTP(httptest.NewRecorder(),
		httptest.NewRequest(http.MethodGet, "/controls/1/copies/2/review?page=3", nil))

	line := decodeOneLine(t, buf)
	if got, want := line["path"], "/controls/1/copies/2/review?page=3"; got != want {
		t.Errorf("path: got %q, want %q", got, want)
	}
}

// TestRequestLogDemotesHealthToDebug pins that /health goes to DEBUG rather
// than INFO: the container healthcheck polls it every few seconds and would
// bury every other line.
func TestRequestLogDemotesHealthToDebug(t *testing.T) {
	buf := &bytes.Buffer{}
	logger := captureLogs(buf)
	wrapped := middleware.RequestLog(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	wrapped.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/health", nil))

	line := decodeOneLine(t, buf)
	if got, want := line["level"], "DEBUG"; got != want {
		t.Errorf("level: got %q, want %q — /health should not compete with real traffic at INFO", got, want)
	}
	if got, want := line["path"], "/health"; got != want {
		t.Errorf("path: got %q, want %q", got, want)
	}
}

// TestRequestLogHealthAtDebugIsFilteredAtInfo pins the practical consequence
// of demoting /health: an INFO-level operator log carries zero /health lines.
// Without this the demotion is only a label change.
func TestRequestLogHealthAtDebugIsFilteredAtInfo(t *testing.T) {
	buf := &bytes.Buffer{}
	logger := slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	wrapped := middleware.RequestLog(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	wrapped.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/health", nil))

	if buf.Len() != 0 {
		t.Errorf("INFO-level log wrote %d bytes for /health; want none", buf.Len())
	}
}

// decodeOneLine parses buf as exactly one JSON slog line. More than one line
// means the middleware wrote where nothing else should have; zero lines means
// it wrote nowhere.
func decodeOneLine(t *testing.T, buf *bytes.Buffer) map[string]any {
	t.Helper()
	trimmed := strings.TrimRight(buf.String(), "\n")
	if trimmed == "" {
		t.Fatalf("no log line")
	}
	if strings.Contains(trimmed, "\n") {
		t.Fatalf("more than one log line:\n%s", trimmed)
	}
	var line map[string]any
	if err := json.Unmarshal([]byte(trimmed), &line); err != nil {
		t.Fatalf("json: %v — line %q", err, trimmed)
	}
	return line
}

// jsonNumberInt turns a slog-encoded number into an int; encoding/json decodes
// numeric JSON into float64 by default, so a bare cast would panic on any int.
func jsonNumberInt(t *testing.T, v any) int {
	t.Helper()
	f, ok := v.(float64)
	if !ok {
		t.Fatalf("not a number: %T (%v)", v, v)
	}
	return int(f)
}
