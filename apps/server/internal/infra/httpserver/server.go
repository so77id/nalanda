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

// readHeaderTimeout bounds how long a client may take to send its headers. Left
// unset, a connection that opens and says nothing holds a goroutine forever.
const readHeaderTimeout = 10 * time.Second

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
