// Package httpserver runs an HTTP handler with a bounded, graceful shutdown.
//
// It is infrastructure: it knows about sockets and timeouts and nothing about
// what is being served. The routers under internal/app hand it a handler.
package httpserver

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"
)

// shutdownGrace bounds how long in-flight requests may take to finish once the
// server has stopped accepting. A shutdown with no bound is a process that
// never exits, which in a container means the orchestrator kills it and the
// requests are cut anyway — later and less predictably.
const shutdownGrace = 10 * time.Second

// The five bounds an http.Server needs and does not have by default. Every one
// of them is zero unless set, and zero means "no limit" — so an anonymous
// client can hold a goroutine and a file descriptor for as long as it likes.
//
// This was measured, not assumed: with only ReadHeaderTimeout set, 50 raw
// keep-alive sockets against the real container were still usable after 45s
// idle, 50 of 50, because ReadHeaderTimeout bounds the header read once bytes
// arrive and says nothing about the wait BETWEEN requests (#149 review, F4).
// There is no connection cap and no reverse proxy in front of this yet.
const (
	// readHeaderTimeout bounds how long a client may take to send its headers.
	readHeaderTimeout = 10 * time.Second
	// readTimeout bounds headers plus body.
	readTimeout = 15 * time.Second
	// writeTimeout bounds how long a handler may take to write its response.
	//
	// THIS ONE HAS A KNOWN EXPIRY. ADR-0008 puts a WebSocket session relay on
	// the api surface, and a global write deadline kills a long-lived
	// connection at 30s no matter what the handler is doing. Whoever adds that
	// relay must move this off the server and onto the routes that want it
	// (http.ResponseController, or a second Server for the relay) rather than
	// deleting it here and leaving every ordinary handler unbounded. Flagged by
	// the review verifier, #149.
	writeTimeout = 30 * time.Second
	// idleTimeout is the one the measurement above was about: how long a
	// keep-alive connection may sit between requests.
	idleTimeout = 60 * time.Second
	// maxHeaderBytes caps a request's header block. The default is 1 MB, which
	// is a lot of memory to hand an unauthenticated caller per connection.
	maxHeaderBytes = 1 << 16
)

// Server serves one handler over one listener.
type Server struct {
	listener net.Listener
	http     *http.Server
}

// New binds addr immediately rather than at Serve time. Two things follow, and
// both matter: an address already in use is a startup error the caller can
// report and exit on, and the resolved address is knowable before anything is
// served — which is what lets a caller ask for port 0 and still be told where
// it landed.
func New(addr string, handler http.Handler) (*Server, error) {
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("listen on %s: %w", addr, err)
	}
	return &Server{
		listener: listener,
		http: &http.Server{
			Handler:           handler,
			ReadHeaderTimeout: readHeaderTimeout,
			ReadTimeout:       readTimeout,
			WriteTimeout:      writeTimeout,
			IdleTimeout:       idleTimeout,
			MaxHeaderBytes:    maxHeaderBytes,
		},
	}, nil
}

// Addr is the resolved listen address, with the real port filled in when the
// caller asked for 0.
func (s *Server) Addr() string {
	return s.listener.Addr().String()
}

// Serve serves until ctx is done, then stops accepting and gives in-flight
// requests up to shutdownGrace to finish. It returns nil on a clean shutdown.
func (s *Server) Serve(ctx context.Context) error {
	serveErr := make(chan error, 1)
	go func() { serveErr <- s.http.Serve(s.listener) }()

	select {
	case err := <-serveErr:
		// Nothing has called Shutdown yet, so ErrServerClosed cannot appear
		// here: reaching this branch means the accept loop itself failed.
		return fmt.Errorf("serve on %s: %w", s.Addr(), err)
	case <-ctx.Done():
	}

	// The grace period is derived from a context that is already done, so it
	// must not inherit that cancellation — otherwise Shutdown returns
	// immediately and drains nothing.
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownGrace)
	defer cancel()

	if err := s.http.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	// Shutdown makes Serve return ErrServerClosed; anything else is a real
	// failure the caller should hear about.
	if err := <-serveErr; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve on %s: %w", s.Addr(), err)
	}
	return nil
}

// Close releases the listener without serving.
//
// New binds at construction, so a Server that is constructed and never served
// holds a socket with no way to release it — verified: after dropping the
// reference to such a Server, rebinding its address failed with "address
// already in use" (#149 review, COR-7). Nothing in this WP hits that path,
// because run() always reaches Serve; WP-C2 adds fallible wiring between the
// two, and this is what makes an early return safe.
//
// Calling it after Serve is harmless: http.Server.Shutdown has already closed
// the listener, and a second Close returns an error the caller may ignore.
func (s *Server) Close() error {
	return s.listener.Close()
}
