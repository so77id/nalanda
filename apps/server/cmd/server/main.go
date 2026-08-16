// Command server is the Nalanda backend: one binary serving two delivery
// surfaces (the professor's backoffice and the students' JSON/WS API) over one
// shared domain. See docs/decisions/0033-the-backend-is-born-with-the-controls.md.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/so77id/nalanda/apps/server/internal/infra/httpserver"
)

// defaultAddr is a placeholder until configuration arrives in S2. Loopback
// rather than every interface: nothing here is meant to be reachable from
// outside the machine yet. Port 8081 leaves 8080 to apps/amc-worker.
const defaultAddr = "127.0.0.1:8081"

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	if err := run(logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
	logger.Info("server stopped cleanly")
}

// run holds everything main would otherwise do, so that the only thing outside
// it is the exit code. Wiring lives here and nowhere else: each layer is
// constructed once, in order, and handed to the next.
func run(logger *slog.Logger) error {
	// SIGTERM as well as SIGINT: a container runtime sends the former, and a
	// binary that only listens for Ctrl-C is killed rather than drained.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Routing arrives with the surfaces in S4; until then the server answers
	// 404 to everything, which is enough to prove it starts and drains.
	handler := http.NewServeMux()

	srv, err := httpserver.New(defaultAddr, handler)
	if err != nil {
		return err
	}

	logger.Info("server listening", "addr", srv.Addr())
	return srv.Serve(ctx)
}
