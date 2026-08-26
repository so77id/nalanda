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
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/api"
	"github.com/so77id/nalanda/apps/server/internal/app/web"
	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/oauthstate"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
	"github.com/so77id/nalanda/apps/server/internal/domain/health"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
	"github.com/so77id/nalanda/apps/server/internal/infra/httpserver"
	"github.com/so77id/nalanda/apps/server/internal/infra/oidc"
	"github.com/so77id/nalanda/apps/server/internal/infra/selfcheck"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/controlstore"
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
func rootHandler(backoffice web.Deps, prober health.Prober, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/", web.Router(backoffice))
	// No middleware, and that is the point of §C12: this surface serves
	// anonymous students who join a session with a room code. The professor gate
	// belongs to the backoffice and is mounted there, on the line above.
	// TestTheApiSurfaceIsReachableWithoutASession asserts it stayed that way.
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

	// The auth chain, constructed once and in order: repositories over the
	// database, the domain service over those, the provider beside it, and the
	// surface over both. Nothing below cmd/server builds any of it.
	store := authstore.New(db)
	login := auth.NewLogin(auth.Login{
		Users:          store,
		Identities:     store,
		Sessions:       store,
		Now:            time.Now,
		SessionTTL:     cfg.SessionTTL,
		BootstrapEmail: cfg.BootstrapProfessorEmail,
	})

	if err := warnIfNobodyCanLogIn(ctx, store, cfg, logger); err != nil {
		return err
	}

	// The published question bank (ADR-0032). Loaded once at boot; a
	// failure here IS a startup failure, not a first-request failure, so
	// an operator sees it immediately. Issue #230 wraps it in a LiveBank
	// so a subsequent apps/web publish rotates the in-memory snapshot
	// without a restart; NewLive emits its own boot log line naming the
	// URL and the document/question counts.
	liveBank, err := bank.NewLive(ctx, cfg.QuestionsJSONURL, logger)
	if err != nil {
		return err
	}

	controlStore := controlstore.New(db)
	amcClient := amcworker.New(amcworker.Config{BaseURL: cfg.AmcWorkerURL})
	controlsService := controls.NewService(controls.Service{
		Bank:      liveBank,
		Store:     controlStore,
		Generator: amcClient,
		Analyzer:  amcClient,
		Readings:  controlStore,
		Annotator: amcClient,
		// The annotate loop's master switch (NALANDA_ANNOTATE_ENABLED,
		// issue #190 §Reversibility): defaults to true, the operator can
		// turn the whole flow off without a deploy.
		AnnotateEnabled: cfg.AnnotateEnabled,
		WorkDir:         cfg.WorkDir,
		Now:             time.Now,
		// Constant seed for reproducibility (tex.Compile refuses zero).
		// A per-control seed is a future decision: today every control
		// runs the same shuffle, and re-generating one produces the same
		// pool — which the four traps of ADR-0030 need to be testable
		// against.
		Seed: 4242,
		Log:  logger,
	})

	backoffice := web.Deps{
		Database: storage.NewProber(db),
		Gate: middleware.NewAuth(middleware.Auth{
			Sessions:  store,
			Users:     store,
			Now:       time.Now,
			PublicURL: cfg.PublicURL,
			LoginPath: handler.LoginPath,
			Log:       logger,
		}),
		Professors: handler.NewProfessors(handler.Professors{
			Users: store,
			Admin: auth.NewAdmin(auth.Admin{
				Users:    store,
				Sessions: store,
				Now:      time.Now,
			}),
			PublicURL: cfg.PublicURL,
			Log:       logger,
		}),
		Controls: handler.NewControls(handler.Controls{
			Service:      controlsService,
			Bank:         liveBank,
			PublicURL:    cfg.PublicURL,
			MaxScanBytes: cfg.MaxScanBytes,
			// The default hook: logs and does nothing. A future
			// integration (email, Canvas) replaces it here without
			// touching the flow (issue #190).
			OnCorrectionClosed: controls.NewNoopHook(logger),
			Log:                logger,
		}),
		Login: handler.NewAuth(handler.Auth{
			Login: login,
			Provider: oidc.NewGoogle(oidc.GoogleConfig{
				ClientID:     cfg.GoogleClientID,
				ClientSecret: cfg.GoogleClientSecret,
			}),
			ProviderName:      oidc.Provider(),
			State:             oauthstate.New(oauthstate.DefaultTTL, time.Now),
			PublicURL:         cfg.PublicURL,
			TrustProxyHeaders: cfg.TrustProxyHeaders,
			Log:               logger,
		}),
		Log: logger,
	}

	srv, err := httpserver.New(cfg.Addr, rootHandler(backoffice, storage.NewProber(db), logger))
	if err != nil {
		return err
	}

	logger.Info("server listening", "addr", srv.Addr())
	return srv.Serve(ctx)
}

// warnIfNobodyCanLogIn says so at boot when the database holds no professors and
// no bootstrap address is configured.
//
// That combination is a backoffice nobody can ever enter, and every symptom of
// it appears somewhere else: the login page works, Google works, and the
// callback refuses the professor who owns the server. It is a warning rather
// than an error because it is a legitimate state — a server whose professors
// have all been deactivated is still a server worth starting so that somebody
// can fix it.
func warnIfNobodyCanLogIn(ctx context.Context, users auth.UserStore, cfg config.Config, logger *slog.Logger) error {
	count, err := users.CountUsers(ctx)
	if err != nil {
		return err
	}
	if count == 0 && cfg.BootstrapProfessorEmail == "" {
		logger.Warn("no professors exist and no bootstrap address is set, so nobody can log in",
			"set", config.KeyBootstrapProfessorEmail)
	}
	return nil
}
