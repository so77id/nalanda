// Command server is the Nalanda backend: one binary serving two delivery
// surfaces (the professor's backoffice and the students' JSON/WS API) over one
// shared domain. See docs/decisions/0034-the-backend-is-born-with-the-controls.md.
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
	"github.com/so77id/nalanda/apps/server/internal/domain/health"
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
		if err := selfcheck.Probe(context.Background(), cfg.Addr, web.HealthPath); err != nil {
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

// rootHandler composes the two delivery surfaces into the handler the server
// serves (ADR-0034 §C11: one binary, two surfaces, one shared domain).
//
// It is a function rather than four lines inside run() so that the composition
// can be tested. It was inline first, and deleting the /api/ mount left the
// whole suite green while the built binary answered 404 on /api/health — the
// WP's headline deliverable, uncovered (#149 review, F7).
//
// The mount prefixes are asserted by main_test.go against the routes the
// surfaces actually register, because this file and each router both hold an
// opinion about the "/api/" prefix and nothing else reconciles them.
func rootHandler(prober health.Prober, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/", web.Router(prober, logger))
	mux.Handle("/api/", api.Router(prober, logger))
	return mux
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
	logger.Info("migrations up to date", "applied", applied, "database", cfg.SafeDatabaseURL())

	srv, err := httpserver.New(cfg.Addr, rootHandler(storage.NewProber(db), logger))
	if err != nil {
		return err
	}

	logger.Info("server listening", "addr", srv.Addr())
	return srv.Serve(ctx)
}
