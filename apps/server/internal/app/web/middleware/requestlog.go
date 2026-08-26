package middleware

import (
	"log/slog"
	"net/http"
	"net/url"
	"time"
)

// RequestLog wraps next and writes one slog line per HTTP request with
// method, path, status, bytes written and duration.
//
// The gate below records "who is asking" (Resolve) and the CSRF middleware
// records refusals, but nothing records the request itself: on 2026-08-26 a
// backoffice RUT edit reported silent failure and `docker-compose logs server`
// showed only startup lines. This middleware exists so the next round of
// diagnosis is not blind (issue #228 S1).
//
// A container healthcheck polls /health every few seconds; that line would
// dominate the log without carrying any diagnostic value, so it drops to DEBUG
// rather than INFO. Everything else is INFO — an operator reading the log
// wants to see one line per request. The path is logged with its query string
// EXCEPT on the OAuth callback, where `?code=...&state=...` are one-shot
// credentials that RFC 6749 §10.3 warns against persisting to logs; there we
// keep the bare path (S3 review, SEC-1).
//
// The log line is emitted from a `defer` so a panic in the wrapped handler
// still produces a request line — the exact "silent failure, docker logs
// shows nothing" symptom that motivated S1 recurs on panic without the
// defer (S3 review, COR-1).
func RequestLog(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			level := slog.LevelInfo
			if r.URL.Path == "/health" {
				level = slog.LevelDebug
			}
			logger.LogAttrs(r.Context(), level, "request",
				slog.String("method", r.Method),
				slog.String("path", loggedPath(r.URL)),
				slog.Int("status", rec.status),
				slog.Int64("bytes", rec.bytes),
				slog.Int64("duration_ms", time.Since(start).Milliseconds()),
			)
		}()
		next.ServeHTTP(rec, r)
	})
}

// loggedPath is the URL a request line names. Everything except the OAuth
// callback keeps its query string; the callback drops it, because the
// `code` and `state` params are one-shot credentials that must not sit in
// the docker log rotation (S3 review, SEC-1).
//
// The callback path is spelled here as a literal string rather than
// imported from `handler.LoginCallbackPath`: `middleware` sits below
// `handler` in the dependency graph, and adding an upward import to name
// one string would invert the layering the package doc pins.
func loggedPath(u *url.URL) string {
	if u.Path == "/login/google/callback" {
		return u.Path
	}
	return u.RequestURI()
}

// statusRecorder wraps a ResponseWriter to capture the final status and the
// number of bytes written. A handler that writes to the body without calling
// WriteHeader still counts as 200 — the same rule net/http applies internally.
//
// TODO(streaming): this wrapper embeds only `http.ResponseWriter` and does
// NOT re-implement `http.Hijacker`, `http.Flusher` or `http.Pusher`. Nothing
// in the tree upgrades today (no SSE, no WebSocket, no HTTP/2 push), so a
// naive wrap is proportionate; but this middleware is now the outermost
// wrap over BOTH surfaces (`cmd/server/main.go` `rootHandler`), so the
// first streaming handler added on either surface will silently fail its
// `w.(http.Flusher)` and `w.(http.Hijacker)` upgrades. Fix path: delegate
// each of the three via a type assertion on the embedded writer. Spec:
// `net/http` documents each interface; the classic pattern is described
// in the `httpsnoop` project's README (github.com/felixge/httpsnoop).
type statusRecorder struct {
	http.ResponseWriter
	status      int
	bytes       int64
	wroteHeader bool
}

func (r *statusRecorder) WriteHeader(status int) {
	if r.wroteHeader {
		return
	}
	r.status = status
	r.wroteHeader = true
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if !r.wroteHeader {
		r.wroteHeader = true
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += int64(n)
	return n, err
}
