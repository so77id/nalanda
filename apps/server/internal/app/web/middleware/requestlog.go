package middleware

import (
	"log/slog"
	"net/http"
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
// wants to see one line per request. The path is logged raw (query string
// preserved) because a bug report ("editar RUT no persiste") is often
// identified by the query params the browser sent.
func RequestLog(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		level := slog.LevelInfo
		if r.URL.Path == "/health" {
			level = slog.LevelDebug
		}
		logger.LogAttrs(r.Context(), level, "request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.RequestURI()),
			slog.Int("status", rec.status),
			slog.Int64("bytes", rec.bytes),
			slog.Int64("duration_ms", time.Since(start).Milliseconds()),
		)
	})
}

// statusRecorder wraps a ResponseWriter to capture the final status and the
// number of bytes written. A handler that writes to the body without calling
// WriteHeader still counts as 200 — the same rule net/http applies internally.
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
