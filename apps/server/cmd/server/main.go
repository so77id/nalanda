// Command server is the Nalanda backend: one binary serving two delivery
// surfaces (the professor's backoffice and the students' JSON/WS API) over one
// shared domain. See docs/decisions/0034-the-backend-is-born-with-the-controls.md.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/api"
	"github.com/so77id/nalanda/apps/server/internal/app/web"
	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/oauthstate"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/domain/canvas"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
	"github.com/so77id/nalanda/apps/server/internal/domain/files"
	"github.com/so77id/nalanda/apps/server/internal/domain/gmail"
	"github.com/so77id/nalanda/apps/server/internal/domain/health"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/matching"
	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
	"github.com/so77id/nalanda/apps/server/internal/domain/secret"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/domain/uploads"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore"
	// Aliased because the domain package one import above owns the name:
	// the domain is what the rest of this file talks about, and the
	// adapter appears exactly once, in the constructor below.
	canvasapi "github.com/so77id/nalanda/apps/server/internal/infra/canvas"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
	"github.com/so77id/nalanda/apps/server/internal/infra/email"
	"github.com/so77id/nalanda/apps/server/internal/infra/httpserver"
	"github.com/so77id/nalanda/apps/server/internal/infra/oidc"
	"github.com/so77id/nalanda/apps/server/internal/infra/selfcheck"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/controlstore"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/coursestore"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/jobstore"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/secretstore"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/surveystore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// healthFlag makes the binary its own healthcheck client. The production image
// is `scratch` and has no shell, no curl and no wget, so the only executable a
// container healthcheck can invoke is this one.
var healthFlag = flag.Bool("health", false,
	"probe this server's own /health endpoint and exit non-zero unless it answers 200")

// syncFilesFlag is the migration to S3 as one command (issue #338,
// DEPLOY-JETSON.md): the reconcile, run once against the bucket whatever
// NALANDA_FILES_STORE says — the files go up BEFORE the store is flipped.
var syncFilesFlag = flag.Bool("sync-files", false,
	"upload every project's local files the S3 bucket lacks or holds older, print one summary line, "+
		"and exit non-zero if any project failed; never downloads, never deletes")

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

	if *syncFilesFlag {
		os.Exit(syncFiles(logger))
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
	// Request logging is outermost and covers BOTH surfaces: the gate above
	// records who is asking, this records what was asked (issue #228 S1). It
	// wraps the composition rather than each router individually so a route
	// added on either side is logged by construction.
	return middleware.RequestLog(logger, mux)
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
	// The ticker owns the poll cadence (NALANDA_BANK_REFRESH_INTERVAL,
	// issue #230): a zero interval disables it — the manual admin button
	// is then the only refresh path — otherwise Watch calls Reload every
	// interval and exits when ctx does at shutdown.
	go liveBank.Watch(ctx, cfg.BankRefreshInterval)

	controlStore := controlstore.New(db)
	// One coursestore for the three things that read `course`, `student`
	// and `enrollment`: the roster service below, and the matcher the
	// controls service needs (issue #272). The type is stateless over the
	// handle, so a second instance would be harmless — one is simply the
	// honest statement that they are the same tables.
	courseStore := coursestore.New(db)

	// Issue #271: the Canvas integration. The secret store is nil when the
	// operator has not set NALANDA_SECRETS_MASTER_KEY — a legal, boot-able
	// state (ADR-0068 §Decision 3), and canvas.Service renders it as
	// "no configurada" rather than refusing to start. A key that IS set and
	// malformed never reaches here: config.Load already failed the boot.
	var canvasSecrets secret.Store
	if cfg.SecretsConfigured() {
		secrets, err := secretstore.New(db, cfg.SecretsMasterKey)
		if err != nil {
			// Unreachable for a key config.Load accepted; a panic at wiring
			// time is what §Errors allows here, and silence would be a
			// deployment that stores nothing while looking healthy.
			panic("wiring the secret store: " + err.Error())
		}
		canvasSecrets = secrets
	} else {
		logger.Warn("the Canvas integration is disabled",
			"reason", "no "+config.KeySecretsMasterKey+" is set",
			"effect", "professors cannot store a Canvas token")
	}
	canvasService := canvas.NewService(canvasSecrets, canvasapi.New(cfg.CanvasGraphQLURL))
	// Issue #273: the professor's Gmail authorisation, on the SAME OAuth
	// client as the login. It shares the client id and secret and nothing
	// else — its own scopes, its own grant, its own nonce store.
	//
	// canvasSecrets is passed deliberately, nil and all: without a master
	// key this deployment can store no credential of any kind, and
	// gmail.Service renders that as "no configurada" rather than refusing
	// to start. Same state, same handling, as the Canvas line above.
	gmailService := gmail.NewService(gmail.Service{
		Authorizer: oidc.NewGmailAuthorizer(oidc.GoogleConfig{
			ClientID:     cfg.GoogleClientID,
			ClientSecret: cfg.GoogleClientSecret,
		}),
		Secrets:  canvasSecrets,
		Accounts: store,
		Log:      logger,
	})
	rosterService := roster.NewService(courseStore, roster.NewCanvasSource(canvasService))

	// Issue #273: the mail transport, selected ONCE at boot and logged in
	// one line — the "select don't describe" shape of DocumentBuddy's
	// ADR-021. Nothing downstream branches on the mode, so no caller can be
	// in one mode while its neighbour is in another, and an operator
	// reading the first lines of the log knows whether this process can
	// reach a student.
	dispatcher := buildDispatcher(cfg.EmailMode, gmailService, logger)
	logger.Info("email dispatcher", "mode", cfg.EmailMode)

	// Issue #338: the store every work file a page or a download hands out
	// is read through, selected ONCE at boot and logged in one line, like
	// the mail transport above. ONE for both subsystems, like the volume —
	// and, under s3, the sync the worker client runs around every call.
	fileStore, fileSync := buildFileStore(cfg, logger)
	logger.Info("file store", "store", cfg.FilesStore, "bucket", cfg.FilesS3Bucket, "region", cfg.FilesS3Region)
	amcClient := amcworker.New(amcworker.Config{BaseURL: cfg.AmcWorkerURL, Sync: fileSync})
	// Under s3, the reconcile at boot and every day at 03:00 UTC (issue #338
	// §5): what a rollback to local wrote meanwhile, and what a push a
	// failure or a deadline cut short left behind, goes up.
	if sync, ok := fileSync.(*filestore.Sync); ok {
		go reconcileDaily(ctx, &filestore.Reconciler{
			Sync:      sync,
			Projects:  allProjects(controlStore, surveystore.New(db)),
			Exclusive: amcClient.Exclusive,
			Log:       logger,
		}, logger)
	}
	controlsService := controls.NewService(controls.Service{
		Bank:      liveBank,
		Store:     controlStore,
		Generator: amcClient,
		Analyzer:  amcClient,
		Readings:  controlStore,
		Annotator: amcClient,
		// Issue #272: what turns a RUT off the sheet into a student on
		// the control's course. The controls domain declares the port
		// (controls.Matcher) and this is what satisfies it.
		Matcher: matching.NewService(courseStore),
		// Issue #273: the two facts a publication needs that the controls
		// tables do not hold. coursestore owns the roster's tables and
		// authstore owns `users`, so each satisfies the port over the data
		// it already keeps — the health.Prober shape.
		Roster:  courseStore,
		Senders: store,
		// Issue #273: what a publication sends through. Which of the four
		// transports this is was decided at boot, above; nothing in the
		// domain asks which one it got.
		Dispatcher: dispatcher,
		// The annotate loop's master switch (NALANDA_ANNOTATE_ENABLED,
		// issue #190 §Reversibility): defaults to true, the operator can
		// turn the whole flow off without a deploy.
		AnnotateEnabled: cfg.AnnotateEnabled,
		WorkDir:         cfg.WorkDir,
		Files:           fileStore,
		Now:             time.Now,
		// Constant seed for reproducibility (tex.Compile refuses zero).
		// A per-control seed is a future decision: today every control
		// runs the same shuffle, and re-generating one produces the same
		// pool — which the four traps of ADR-0030 need to be testable
		// against.
		Seed: 4242,
		Log:  logger,
	})

	// Epic #308: the survey subsystem (ADR-0078). Its own store over its
	// own tables; it shares the database handle, the worker client and the
	// shared volume with the controls, and no type.
	surveyService := survey.NewService(survey.Service{
		Store:     surveystore.New(db),
		Generator: amcClient,
		Analyzer:  amcClient,
		WorkDir:   cfg.WorkDir,
		Files:     fileStore,
		Now:       time.Now,
	})

	// Issue #249: the async job runner. One goroutine, one queue,
	// jobs persisted so a Watchtower restart does not lose them.
	// Handlers register per Kind as the WP migrates each operation
	// off the sync path — this ships with KindReanalyse (S3); S4–S6
	// add analyse, generate and annotate.
	jobStore := jobstore.New(db)
	jobRunner := jobs.NewRunner(jobStore, jobs.Handlers{
		jobs.KindReanalyse: controls.NewReanalyseHandler(controlsService),
		jobs.KindAnalyse:   controls.NewAnalyseHandler(controlsService),
		jobs.KindGenerate:  controls.NewGenerateHandler(controlsService),
		jobs.KindAnnotate:  controls.NewAnnotateHandler(controlsService),
		jobs.KindPublish:   controls.NewPublishHandler(controlsService),
		// Issue #310: the survey Kinds, from the owning domain (ADR-0079).
		jobs.KindSurveyGenerate: survey.NewGenerateHandler(surveyService),
		jobs.KindSurveyAnalyse:  survey.NewAnalyseHandler(surveyService),
	}, logger, time.Now)
	if err := jobRunner.Sweep(ctx); err != nil {
		return err
	}
	go jobRunner.Start(ctx)

	// Issue #339: the partials of chunked scan uploads, on the shared volume
	// beside controls/ and surveys/. A partial nobody resumed for a day is
	// swept at boot and then hourly. A failed sweep does not stop the boot —
	// the partials cost disk, not correctness, and the next tick retries.
	// ONE Service for every handler that touches an upload: its per-upload
	// locks are what keep a chunk, a complete and the sweep apart.
	uploadsService := uploads.NewService(uploads.Service{
		Root:     filepath.Join(cfg.WorkDir, uploads.DirName),
		MaxBytes: cfg.MaxScanBytes,
		Log:      logger,
	})
	if removed, err := uploadsService.Sweep(time.Now()); err != nil {
		logger.Warn("sweeping idle upload partials at boot", "error", err)
	} else if removed > 0 {
		logger.Info("swept idle upload partials at boot", "removed", removed)
	}
	go uploadsService.Watch(ctx, uploads.SweepEvery, time.Now)

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
			Service: controlsService,
			// Issue #272: the roster, as these screens need it — the
			// course list for the create form's select, and the people
			// on one course so a copy shows a name. The same
			// rosterService the Courses and Profile handlers hold;
			// it satisfies handler.RosterReader.
			Roster:       rosterService,
			Bank:         liveBank,
			PublicURL:    cfg.PublicURL,
			MaxScanBytes: cfg.MaxScanBytes,
			// The default hook: logs and does nothing. A future
			// integration (email, Canvas) replaces it here without
			// touching the flow (issue #190).
			OnCorrectionClosed: controls.NewNoopHook(logger),
			// Issue #273: whether the professor at the keyboard can send at
			// all — the control page gates "Publicar" on it, and the POST
			// refuses on it. *gmail.Service satisfies the narrow port.
			Gmail: gmailService,
			// Issue #249: the async job runner (banner + Submit calls).
			Jobs:    jobStore,
			Runner:  jobRunner,
			Uploads: uploadsService,
			Log:     logger,
		}),
		Profile: handler.NewProfile(handler.Profile{
			Canvas: canvasService,
			Roster: rosterService,
			Gmail:  gmailService,
			// A SECOND nonce store, never the login's. Sharing it would
			// let a nonce issued for one grant be spent on the other, and
			// the two grants carry different scopes
			// (handler.GmailStateCookieName says the rest).
			GmailState: oauthstate.New(oauthstate.DefaultTTL, time.Now),
			PublicURL:  cfg.PublicURL,
			Log:        logger,
		}),
		Courses: handler.NewCourses(handler.Courses{
			Roster: rosterService,
			// Issue #272 S5: the retroactive pass. controls.Service is
			// what satisfies handler.CourseControls.
			Controls:  controlsService,
			PublicURL: cfg.PublicURL,
			Log:       logger,
		}),
		Students: handler.NewStudents(handler.Students{
			// Issue #272 S8. Two ports over the two services that
			// already exist: the person from the roster, their copies
			// from the controls domain.
			Roster: rosterService,
			Record: controlsService,
			Log:    logger,
		}),
		AdminBank: handler.NewAdminBank(handler.AdminBank{
			Bank:      liveBank,
			PublicURL: cfg.PublicURL,
			Log:       logger,
		}),
		Surveys: handler.NewSurveys(handler.Surveys{
			Service:      surveyService,
			Courses:      rosterService,
			Jobs:         jobStore,
			Runner:       jobRunner,
			PublicURL:    cfg.PublicURL,
			Log:          logger,
			MaxScanBytes: cfg.MaxScanBytes,
			Uploads:      uploadsService,
		}),
		Uploads: handler.NewUploads(handler.Uploads{
			Service: uploadsService,
			Log:     logger,
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

// buildDispatcher picks the transport for the selected mode.
//
// The switch is exhaustive over config's closed set and still ends in a
// panic, which is not belt-and-braces theatre: config.Load is what refuses
// an unknown mode, so reaching the default here means somebody added a
// fifth EmailMode constant and did not come back to this function. A panic
// at wiring time is the failure that gets noticed; a silent fall-through to
// stub is a deployment that looks healthy and sends nothing
// (backend-code-style.md §Errors — never in a request path, right here).
// allProjects is every project the database knows — controls archived or
// not, every survey run — as files.Store paths: what the reconcile walks.
func allProjects(controlStore controls.Store, surveyStore survey.Store) func(context.Context) ([]string, error) {
	return func(ctx context.Context) ([]string, error) {
		paths, err := controls.ProjectPaths(ctx, controlStore)
		if err != nil {
			return nil, err
		}
		runs, err := survey.RunProjectPaths(ctx, surveyStore)
		if err != nil {
			return nil, err
		}
		return append(paths, runs...), nil
	}
}

// reconcileDaily runs the reconcile once at boot — when a rollback's delta
// or a push a restart cut short is waiting — and then every day at 03:00
// UTC, for as long as ctx lives.
func reconcileDaily(ctx context.Context, rec *filestore.Reconciler, log *slog.Logger) {
	for {
		if _, err := rec.Run(ctx); err != nil {
			log.Error("files: reconcile", "error", err)
		}
		timer := time.NewTimer(time.Until(filestore.NextReconcile(time.Now())))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

// syncFiles is -sync-files: the database read for its projects (never
// migrated — the running server owns the schema), the reconcile run once
// against the bucket, and the exit code. It runs in a process of its own,
// so it cannot hold the running server's worker lock: the procedure runs
// it with no job in flight, and a file a job rewrites mid-upload fails its
// Content-MD5, counts as a failed project, and goes up on the next run.
func syncFiles(logger *slog.Logger) int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg, err := config.LoadFromEnv()
	if err != nil {
		logger.Error("sync-files", "error", err)
		return 1
	}
	if !cfg.FilesS3Configured() {
		logger.Error("sync-files needs the bucket and the server's key, whatever the store",
			"needs", strings.Join([]string{config.KeyFilesS3Bucket, config.KeyFilesS3Region,
				config.KeyFilesS3AccessKeyID, config.KeyFilesS3SecretAccessKey}, ", "))
		return 1
	}
	db, err := storage.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("sync-files", "error", err)
		return 1
	}
	defer func() { _ = db.Close() }()
	store := filestore.NewS3(
		filestore.NewS3Client(cfg.FilesS3Region, cfg.FilesS3AccessKeyID, cfg.FilesS3SecretAccessKey),
		cfg.FilesS3Bucket)
	rec := &filestore.Reconciler{
		Sync:      filestore.NewSync(store, cfg.WorkDir, logger),
		Projects:  allProjects(controlstore.New(db), surveystore.New(db)),
		Exclusive: func(fn func() error) error { return fn() },
		Log:       logger,
	}
	summary, err := rec.Run(ctx)
	return syncFilesExit(summary, err, os.Stdout)
}

// syncFilesExit prints -sync-files' one line and picks its exit code: 0
// only when every project went up.
func syncFilesExit(summary filestore.Summary, err error, out io.Writer) int {
	if err != nil {
		_, _ = fmt.Fprintf(out, "sync-files: %v\n", err)
		return 1
	}
	_, _ = fmt.Fprintf(out, "sync-files: %d projects, %d files uploaded (%d bytes), %d failed, took %s\n",
		summary.Projects, summary.Files, summary.Bytes, summary.Failed, summary.Took)
	if summary.Failed > 0 {
		return 1
	}
	return 0
}

// buildFileStore maps the configured store onto its adapter. config.Load has
// already refused an unknown value and, under s3, any missing variable, so
// the default branch is a value someone added without coming back here: a
// panic at boot, never a quiet fall back to local — a server that looks
// healthy and keeps nothing off the Jetson.
//
// The second value is the sync the worker client wraps each call in: nil —
// a nil INTERFACE, never a nil *filestore.Sync inside one — under local,
// whose files are the working copy itself.
func buildFileStore(cfg config.Config, log *slog.Logger) (files.Store, amcworker.ProjectSync) {
	switch cfg.FilesStore {
	case config.FilesStoreLocal:
		return filestore.NewLocal(cfg.WorkDir), nil
	case config.FilesStoreS3:
		client := filestore.NewS3Client(cfg.FilesS3Region, cfg.FilesS3AccessKeyID, cfg.FilesS3SecretAccessKey)
		store := filestore.NewS3(client, cfg.FilesS3Bucket)
		return store, filestore.NewSync(store, cfg.WorkDir, log)
	default:
		panic("main.buildFileStore: no adapter for file store " + string(cfg.FilesStore))
	}
}

func buildDispatcher(mode config.EmailMode, creds email.Credentials, log *slog.Logger) controls.Dispatcher {
	switch mode {
	case config.EmailModeStub:
		return email.NewStubDispatcher()
	case config.EmailModeDryRun:
		return email.NewDryRunDispatcher(creds, log)
	case config.EmailModeStaging:
		return email.NewStagingDispatcher(email.NewGmailDispatcher(email.GmailConfig{Credentials: creds}))
	case config.EmailModeReal:
		// `real` does NOT mean "always send to the student": it means the
		// per-publication choice the professor made on the form is
		// honoured, and the staging half of that choice is applied by the
		// publish job, which is the only layer that knows what was asked
		// for. This transport is the one that actually delivers.
		return email.NewGmailDispatcher(email.GmailConfig{Credentials: creds})
	default:
		panic("main.buildDispatcher: no transport for mail mode " + string(mode))
	}
}
