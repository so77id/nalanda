// A white-box test, deliberately in package httpserver.
//
// The bounds below are invisible from outside the process — no request can tell
// you what IdleTimeout is — and every one of them defaults to "no limit", so
// what they prevent is a slow leak rather than a broken response. A black-box
// test would have to hold sockets open for a minute to observe them, which is a
// test that measures the machine rather than the code.
package httpserver

import (
	"net/http"
	"testing"
	"time"
)

// Measured case behind this: with only ReadHeaderTimeout set, 50 raw keep-alive
// sockets against the real container were still usable after 45s idle — 50 of
// 50 (#149 review, F4).
func TestTheServerBoundsEveryPhaseOfARequest(t *testing.T) {
	srv, err := New("127.0.0.1:0", http.NotFoundHandler())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer func() { _ = srv.Close() }()

	for _, c := range []struct {
		name string
		got  time.Duration
	}{
		{"ReadHeaderTimeout", srv.http.ReadHeaderTimeout},
		{"ReadTimeout", srv.http.ReadTimeout},
		{"WriteTimeout", srv.http.WriteTimeout},
		{"IdleTimeout", srv.http.IdleTimeout},
	} {
		if c.got <= 0 {
			t.Errorf("%s = %v, want a positive bound — zero means no limit", c.name, c.got)
		}
	}
	if srv.http.MaxHeaderBytes <= 0 {
		t.Errorf("MaxHeaderBytes = %d, want a positive cap — the default is 1 MB per connection", srv.http.MaxHeaderBytes)
	}

	// IdleTimeout is the one the measurement was about, and Go falls back to
	// ReadTimeout when it is zero — so a future edit that drops it would be
	// silently half-covered. Pin that it is set in its own right.
	if srv.http.IdleTimeout == 0 {
		t.Error("IdleTimeout is zero; http.Server would fall back to ReadTimeout and the fallback is not the intent")
	}
}
