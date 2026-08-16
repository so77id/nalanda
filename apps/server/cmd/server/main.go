// Command server is the Nalanda backend: one binary serving two delivery
// surfaces (the professor's backoffice and the students' JSON/WS API) over one
// shared domain. See docs/decisions/0033-the-backend-is-born-with-the-controls.md.
package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/so77id/nalanda/apps/server/internal/app/api"
	"github.com/so77id/nalanda/apps/server/internal/app/web"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
	"github.com/so77id/nalanda/apps/server/internal/infra/httpserver"
	"github.com/so77id/nalanda/apps/server/internal/infra/selfcheck"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// healthFlag makes the binary its own healthcheck client. The production image
// is `scratch` and has no shell, no curl and no wget, so the only executable a
// container healthcheck can invoke is this one.
var healthFlag = flag.Bool("health", false,
	"probe this server's own /health endpoint and exit non-zero unless it answers 200")

func main() {
	// A bootstrap logger, because the configured level is not known until the
	// configuration is read — and a configuration error has to be reportable.
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	flag.Parse()

	// Before anything is opened. The healthcheck runs every few seconds in a
	// container that is already serving; it must not open the database, and it
	// must certainly not run migrations against it.
	if *healthFlag {
		cfg, err := config.LoadFromEnv()
		if err != nil {
			logger.Error("health check", "error", err)
			os.Exit(1)
		}
		if err := selfcheck.Probe(context.Background(), cfg.Addr); err != nil {
			logger.Error("health check", "error", err)
			os.Exit(1)
		}
		return
	}

	if err := run(logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
	logger.Info("server stopped cleanly")
}

// run holds everything main would otherwise do, so the only thing outside it is
// the exit code. Wiring lives here and nowhere else: each layer is constructed
// once, in order, and handed to the next.
func run(logger *slog.Logger) error {
	// SIGTERM as well as SIGINT: a container runtime sends the former, and a
	// binary that only listens for Ctrl-C is killed rather than drained.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.LoadFromEnv()
	if err != nil {
		return err
	}
	logger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: cfg.SlogLevel()}))

	db, err := storage.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer func() {
		if err := db.Close(); err != nil {
			logger.Error("closing the database", "error", err)
		}
	}()

	// Migrations run at boot rather than as a separate deploy step: the binary
	// and the schema it expects ship together, so there is no window in which
	// one is ahead of the other (ADR-0007).
	applied, err := storage.Migrate(ctx, db, migrations.FS)
	if err != nil {
		return err
	}
	logger.Info("migrations up to date", "applied", applied, "database", cfg.DatabaseURL)

	// One binary, two delivery surfaces, one shared domain (ADR-0033 §C11).
	// The root mux is a plain composition: each surface owns its own paths, so
	// adding a route never requires touching the other one or this file.
	prober := storage.NewProber(db)
	handler := http.NewServeMux()
	handler.Handle("/", web.Router(prober, logger))
	handler.Handle("/api/", api.Router(prober, logger))

	srv, err := httpserver.New(cfg.Addr, handler)
	if err != nil {
		return err
	}

	logger.Info("server listening", "addr", srv.Addr())
	return srv.Serve(ctx)
}
