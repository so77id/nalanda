# CLAUDE.md — server

## Description

The Nalanda backend: one Go binary, two delivery surfaces (the professor's
backoffice and a JSON/WS API for anonymous students), one shared domain,
SQLite underneath. Born with the entrance-controls subsystem
(`docs/design/2026-08-controles.md` §C10) rather than in the abstract.

Since WP-C3 (#151) the backoffice has its shell (nav, both themes, error
pages, one-shot flash cookie) and the professor CRUD. The login round trip
and the session gate arrived earlier with WP-C2 (#150). WP-E (#166) added
the entrance-controls screens (list, create, detail with the printable PDF
downloads); WP-F (#167) turned the Escaneos box live with the whole
reader loop — upload → analyse → results table → side-by-side review
page → re-leer con otra sensibilidad → *Cerrar corrección*. Since #249 the
four minutes-class AMC operations (generate, analyse, reanalyse, close-
annotate) run through an in-process async job runner
(`internal/domain/jobs`), so an HTTP POST returns immediately and the
detail page's `JobBanner` surfaces the running / done / failed state; the
routes table in `README.md` is the current inventory and ADR-0050
records the design. Since #271/#272 the courses, the Canvas roster and
the RUT→student join live here (ADR-0069/0070/0071); since #273 a closed
correction is PUBLISHED — one mail per student, sent as the professor
from their own Gmail account, through a fifth `jobs.Kind` (ADR-0072).
Since #287 that publication is recorded PER COPY and is therefore
resumable, with a per-student send beside it (ADR-0073, which supersedes
ADR-0072 §5).

Commands, stack, configuration and layout live in `README.md` — one home per
fact.

## Mandatory reading

- `docs/standards/backend-code-style.md` — the dependency rule and how to invert
  it, the error and configuration contracts, the HTTP and database rules. Agents
  follow it; they do not innovate on it.
- `docs/standards/testing-strategy.md` §`apps/server` — the two protocols, and
  §"What this level cannot see", which is why the pre-PR one ends in Docker.
- `docs/decisions/0034-the-backend-is-born-with-the-controls.md` — the layered
  layout and why microservices were rejected. Also ADR-0006 (Go), ADR-0007
  (SQLite first, and the Postgres exit), ADR-0009 (professor-only auth) and
  `0036-the-professor-session-is-ours-and-costs-no-dependency.md` — how the
  session works, the three ways in, and why there is no OIDC library.
- `docs/decisions/0038-the-jetson-is-the-first-test-bed.md` — where this app
  runs in production, and the operational triggers for hosting / rate-limiting
  / proxy-trust choices. Any change to the login path, a cookie read/write,
  or `NALANDA_PUBLIC_URL` needs it: the tests here pin the helpers, not their
  callers, and ADR-0038 is where the reasoning lives.
- `docs/decisions/0050-the-controls-runner-is-in-process-single-goroutine.md`
  — the async job runner design. Read before touching
  `internal/domain/jobs`, `internal/infra/storage/jobstore`, or any of the
  five async handlers (`POST /controls`, `POST /controls/{id}/scans`,
  `POST /controls/{id}/reanalyze`, `POST /controls/{id}/close`, and
  `POST /controls/{id}/publish` + `/test-send`). Records
  single-goroutine + SQLite persistence + Sweep-on-boot + no retry + the
  atomicity split that amends ADR-0034 §Failure modes.
- `docs/decisions/0072-corrections-are-mailed-from-the-professors-own-gmail.md`
  — the publication path. Read before touching `internal/domain/gmail`,
  `internal/infra/email`, `Service.Publish`, or the `/profile` connect
  flow. Records why the mail goes out as the PROFESSOR rather than through
  a transactional API, why the Gmail grant is a second authorization and
  not a wider login, the four dispatch modes, and the one question it
  could not settle (§Consequences, "the seven-day question").
- `docs/decisions/0073-publication-is-recorded-per-copy-and-is-resumable.md`
  — it supersedes ADR-0072 §5, and it has its own trigger: read it before
  touching anything that decides WHICH copies go out, stamps one, or
  renders a copy's state. Concretely
  `internal/domain/controls/publication_state.go`, `Service.Publish` /
  `PublishOne` / `ResendToWholeCourse` / `PublicationCounts`, and
  `upsertReading`'s `ON CONFLICT` column list in
  `internal/infra/storage/controlstore/readings.go`.
- `docs/security-notes.md` §"Logs and personal data" — read before adding any
  `slog` call on a path that holds a RUT, a name or a student address. The
  rule is that the identifier stays OUT of the line; the `_action` /
  `_changed` fields carry the diagnostic value. Worked cases:
  `handler/review.go`'s `maskRUT`, and `matching.MatchByRUT`, whose error
  names the course id and never the RUT — it did carry it once, and a
  cancelled rematch would have written one person's RUT per copy into the
  Jetson's log rotation (#272 review, SEC-1).
- `docs/standards/guides/add-a-backend-endpoint.md` — read before adding ANY
  route here: which surface it belongs to, the handler → domain → repository
  chain, and the middleware a state-changing route needs.
- `internal/app/web/static/static.go` package doc + ADR-0047 — read before
  adding ANY vendored front-end library (a JS bundle, a CSS file, a font
  the browser downloads). Shape: `vendor/<lib>/` subdirectory + one more
  entry per file on the explicit `//go:embed` line (never `all:vendor` —
  the point is to keep companion files out), plus a `README.md` beside
  them with four required sections (Version with an "advisories last
  checked" date, Integrity SHA-384s, How it is served, Upgrading).
  Directory-shaped requests answer 404 (both trailing-slash AND bare-name
  — Go's default 301 on a bare directory is refused). The `/static/`
  URL prefix is a string literal spelled in router.go, in the template
  that consumes the asset, and in the vendor README — a rename touches
  all three; there is no shared constant on purpose (see the router
  entry's comment).
- `README.md` §"What is not here yet" — before adding anything, check whether
  the work belongs to **WP-G** (publishing grades) or to the deletion path
  `security-notes.md` records as missing. **WP-C1, WP-C2,
  WP-C3, WP-E, WP-F, and ALL THREE WPs of epic #270 are closed**: the
  layered layout (#149), the login round trip + session gate (#150), the
  backoffice shell + professor CRUD (#151), control creation with the PDF
  pipeline (#166), the scans + review flow (#167), the Canvas roster —
  `course` / `student` / `enrollment` / `user_secrets`, `/profile`,
  `/courses` (#271) — the matching layer (#272), and publication with the
  mail path (#273) all live here.

  **Reuse #272's entry points rather than rebuilding them**: the join is
  `matching.MatchByRUT` (+ `matching.NormalizeRUT`); the reads are
  `controls.Service.ControlsForCourse`, `MatrixForCourse` and
  `ControlsForStudent`; the repair passes are `RematchCourse` /
  `RematchAllCourses`. The policy behind all of them is ADR-0071.

  **And reuse #273's rather than rebuilding them**: the mail port is
  `controls.Dispatcher` (four transports in `internal/infra/email`), the
  authorisation is `gmail.Service` (`Complete` / `Disconnect` /
  `Connection` / `AccessToken`), and the sending loop is
  `controls.Service.Publish`. The policy behind all of them is ADR-0072.

  **And #287's**: one copy's state is `controls.CopyPublicationFor` (with
  `deliverableCopy` behind it) and a whole page's worth is
  `Service.CopyPublications` — use the second from a screen, never a loop
  over the first. The per-student send is `Service.PublishOne`, the bulk
  reset is `Service.ResendToWholeCourse`, the list's counts are
  `Service.PublicationCounts`, and the grade any of them shows a person is
  `controls.GradeFor`. The policy is ADR-0073.

## Language

Code, comments, identifiers, tests and commit messages in **English**, like the
rest of the repo.

**Everything a person reads is Spanish** — the backoffice's rendered text
(the CRUD's list and form, the flash messages, the shell's 404/403/500),
and any message that reaches a student. Same rule as `content/` and as the
LaTeX in `apps/amc-worker`: English stays inside identifiers. Log lines
are English: their reader is an operator looking at the same identifiers.
Worked cases in-tree: `internal/app/web/view/templates/pages/*.html` and
the `avisoNo*` / `flash.Set(…)` string literals in `internal/app/web/handler/`.

## Rules for Claude

- **The dependency rule has FOUR edges; `internal/architecture_test.go`
  enforces the first three**, transitively:
  1. `internal/domain` imports neither `internal/app` nor `internal/infra`, nor
     any third-party package.
  2. **`internal/infra` does not import `internal/app`.** Adapters sit beneath
     the surfaces, not beside them. This edge was missing from the guard for a
     whole WP, and #150 is the one that pushed on it: `internal/infra/oidc` and
     `internal/infra/storage/authstore` both sit below the surface that uses
     them. The OAuth redirect URI is passed IN from the handler for exactly this
     reason — an adapter reading it from the surface would invert the layering.
  3. Neither delivery surface imports the other.

  4. **A delivery surface depends on a domain SERVICE, never on the store
     behind it.** Reads and writes both go through the service; a handler
     that needs a shape the service does not expose gets a service METHOD,
     not the store field. **NOT enforced by the guard** — the package graph
     cannot see it, because handler and store are already allowed to share
     one through the domain. It is a review item, and its check is
     `grep -rn '\.Store\.' internal/app/**/handler/*.go` returning nothing.
     Violated and re-fixed twice: WP-E's review (ARQ-11) removed a second
     injected `Store` field from a handler struct, and #271's review (ARQ-1)
     removed a `c.Roster.Store.ListEnrollments` reach-through that also ran
     one query per row of a list page. Both times the rule lived only in a
     code comment, and the second time that comment was four files away
     from the new violation.

  When the domain needs something from outside, it declares the interface and
  infra implements it — `health.Prober`, implemented by `storage.Prober`, is the
  shape to copy. Full statement and the inversion recipe:
  `docs/standards/backend-code-style.md` §The dependency rule.

  The rule forbids `domain → app` and `domain → infra`, NOT `domain → domain`.
  Worked case since #249: `internal/domain/controls/jobhandlers.go` imports
  `internal/domain/jobs` to satisfy `jobs.Handler`. `jobs.Store` (declared in
  `jobs`, implemented by `jobstore` under `internal/infra`) and `jobs.Handler`
  (declared in `jobs`, implemented from `controls`) are two more shapes to copy
  alongside `health.Prober`.
- **A LIST PAGE GETS ONE AGGREGATE QUERY, NEVER A QUERY PER ROW.** The
  shape is `GROUP BY` into a map the handler indexes by id; the two worked
  cases are `coursestore.EnrollmentCounts` (#271) and
  `controlstore.PublicationCountsSQL` (#287). #271's review removed the
  per-row version from the course list (ARQ-1) and it came back as a
  temptation on the controls list a WP later, because nothing about the
  rendered page looks different when it is wrong. When the aggregate cannot
  express the per-row rule exactly, it may APPROXIMATE it under the three
  conditions in `backend-code-style.md` §"A list-level aggregate may
  APPROXIMATE a per-row domain rule" — never by asking per row instead.
- **Never add a dependency without discussing it.** `go.mod` is a manifest and
  the root `CLAUDE.md` rule applies to it unchanged. The direct set is exactly
  `modernc.org/sqlite` and `github.com/pressly/goose/v3`; there is deliberately
  no router, no test framework and no logging library. Never edit `go.sum` by
  hand.
- **`CGO_ENABLED=0` is load-bearing, not a flag someone once set.** It is what
  lets the binary run on `scratch`. A dependency that needs CGO produces a build
  that succeeds and a container that cannot start — the failure appears at
  `docker run`, and nothing in `go build` or the suite notices.
- **A test that shells out to a subprocess is invisible to Go's build cache.**
  A test package importing nothing from the module counts as unchanged whatever
  happens to the code, so `go test ./...` replays a cached PASS. This is not
  theoretical: the architecture test was written that way first and passed
  through four real violations (#149 S5). Read files with the standard library.
- **Never let a comment claim what the suite does not verify.** When a decision
  cannot be pinned by a test, the comment says so and says why — worked case:
  `storage.Prober`, on `SELECT` versus `Ping`.
- **`docker compose` lives in `infra/local/`, never here.** The app packages
  itself (`Dockerfile`); infra places it. Adding a service or a volume that
  DEV needs is an edit to `infra/local/docker-compose.yml`. **A HOST-SPECIFIC
  production service** (`backup`, `monitor`, `amc-worker`'s prod flip, or the
  next one) is an edit to the overlay
  `infra/deploy/<host>/docker-compose.<host>.yml`, with its own Dockerfile
  and scripts (if any) under `infra/deploy/<host>/` — worked case:
  `infra/deploy/jetson/docker-compose.jetson.yml` overlays server + amc-worker
  with GHCR images and adds the backup/monitor sidecars (#162, #175, ADR-0038,
  `docs/standards/repository-structure.md` §Placement criteria). A dev
  laptop's `docker compose up server` runs only the base compose and never
  touches the overlay; the Jetson's `.env` loads the overlay via
  `COMPOSE_FILE=docker-compose.yml:../deploy/jetson/docker-compose.jetson.yml`.
  The pre-S12 shape (a `profiles: [<host>]` gate inside the base file) was
  rejected in ADR-0038 §Decision "Compose-file shape".
- **Cookie names are computed, not literal.** Since #162 (ADR-0038) both the
  session and OAuth-state cookies carry the `__Host-` prefix when
  `config.SecureCookie()` is true (production, https). Read and write them
  ONLY through `middleware.SessionCookieName(secure)`,
  `handler.StateCookieName(secure)` and — since #273 —
  `handler.GmailStateCookieName(secure)`, whose store and nonce are the
  login flow's deliberately separate twin (see the two-OAuth-flows rule
  below). A bare literal (`"nalanda_session"`,
  `"nalanda_oauth_state"`) is dev-only correct — production stops reading it
  and the login breaks silently on the deployed URL.
  `TestSessionCookieNameCarriesHostPrefixInProductionAndNotInDev` and its
  state-cookie twin pin the two names AGAINST THE HELPERS, not against callers;
  a bypass around them is caught only by review
  (`docs/security-notes.md` §"The login's state cookie is a double-submit
  cookie", §"The session cookie has no `Secure` flag in development").
- **A new configuration variable is added in FOUR places, and since #150 all four
  are gated**: `.env.example` (`TestExampleEnvFileDeclaresEveryVariable`, which
  demands a real declaration), plus `infra/local/docker-compose.yml`,
  `.github/workflows/server.yml` and the table in `README.md` §Configuration
  (`TestEveryVariableReachesAllFourHomes`). The guard reads those three as TEXT
  rather than parsing them: the two that are EXECUTED must declare the key on a
  non-comment line, the README need only mention it. It was added because the
  rule drifted inside the PR that restated it, and it found a gap older than that
  PR on its first run. A REQUIRED variable missing from compose or CI still makes
  the container refuse to start, and compose sits outside CI's path filters — the
  guard is why that is now caught before the L8 step rather than by it. Worked
  case: `NALANDA_TRUST_PROXY_HEADERS` landed in all four homes in the same
  commit at #162; `TestEveryVariableReachesAllFourHomes` was what caught the
  early revision that had it missing from `.github/workflows/server.yml`.

  **And a FIFTH home no test can reach: if the JETSON needs the variable, `infra/local/DEPLOY-JETSON.md`'s `.env` block.** The guard reads only the four in-repo homes; the Jetson's `.env` is typed by hand from that block. `NALANDA_EMAIL_MODE` was missing from it in #273, so the DOCUMENTED deploy path produced a server that could mail nobody — and the shape that bites is exactly a variable the loader treats as optional but production does not, because the guard cannot tell those apart (ADR-0072 §5).
- **The migration numbering carries a scar worth knowing.** #150 deleted #149's
  empty `00001_init.sql` as planned, and still numbered the auth schema `00002`:
  goose keys applied migrations by VERSION, so a file reusing number 1 counts as
  already applied on every database that ran the placeholder, and its contents
  would never arrive. `TestTheAuthMigrationAppliesOverADatabaseThatRanThe`
  `Placeholder` covers that upgrade path — no other case can see it, since they
  all start from an empty file.
- The database file, its `-wal`/`-shm` siblings and a locally built binary are
  gitignored. Never commit `.env`, which now holds a real OAuth client secret.
- **Nothing here can test the Google integration.** The suite drives
  `oidctest.Provider`; the real round trip is `GOOGLE-CHECK.md`, and a change to
  the login path is unfinished while a human has not run it. Same rule, and the
  same reason, as `apps/amc-worker/PAPER-CHECK.md`.
- **Nothing here can test Canvas, either (issue #271).** The suite drives
  `httptest` fakes in `internal/infra/canvas`, the way it drives
  `oidctest.Provider` for Google. What no test can see: whether the GraphQL
  queries match Canvas's real schema, whether `user.sisId` still carries the
  RUT, and whether the token survives the round trip without reaching a log.
  Any change to the queries in `internal/infra/canvas`, the normalisation in
  `internal/domain/canvas/roster.go`, the `/profile` token path, or
  `NALANDA_CANVAS_GRAPHQL_URL` is unfinished while a human has not run
  [`CANVAS-CHECK.md`](CANVAS-CHECK.md). Same rule, and the same reason, as
  the Google and paper bullets. The measured contract lives in ADR-0069;
  `student.rut` holds the eight digits the sheet prints and `student.rut_dv`
  the verifier Canvas attaches, and a caller that stores `sisId` whole would
  match nobody in WP-2 while looking correct on every roster screen.
- **Nothing here can test paper, either.** The tex generator lives in
  `internal/domain/controls/tex/**`, and the suite pins tokens
  (`TestPreambleDeclaresLetterPaperWhenInputSaysLetter` and its A4/empty
  twins pin each `\documentclass` option's presence and the others'
  absence, ADR-0043) but sees no printer, no scanner and no ink. Any change
  to the preamble — paper option, font size, margin package, an added
  `\usepackage` — is unfinished while `apps/amc-worker/PAPER-CHECK.md` has
  not run against it. Since ADR-0043 the professor picks paper per
  control, so a real check now needs one Letter batch and one A4 batch
  (PAPER-CHECK.md §1). Same rule, and the same reason, as the Google
  bullet above; the failure mode is on paper (2026-08-19: 44 pages
  `+0/0/0+`, ADR-0042 §Context — the fixed-Letter that ADR-0043 makes
  configurable).
- **The uploaded scan batch survives every downstream failure of the
  scan pipeline (issue #210, still true after #249).** Reintroducing
  `os.Remove(batchHostPath)` on a refusal — or on any post-copy error
  — is forbidden. The batch on disk is the artefact an operator
  inspects and what the professor would otherwise have to re-scan;
  erasing it on refusal was the pre-#210 behavior that made the
  2026-08-19 incident cost twenty SSH minutes to diagnose (same
  incident ADR-0042 §Context and the paper-check bullet above
  reference — that WP fixed the printer cause, this one fixes the
  diagnosis path). `writeUpload` still cleans a PARTIAL file (its own
  `io.Copy` failure); downstream failures do not. Since #249 the
  invariant depends on the sync/async split: the file write happens
  in `Service.SaveUploadedBatch` on the HTTP goroutine BEFORE
  `Runner.Submit`. Moving the file write into the analyse job handler
  is forbidden for the same reason — a Submit failure would then
  discard the batch. Transactional scoping of the async writes
  (upsert readings + mark missing + set state) lives on
  `Service.AnalyzeBatch`'s docstring.
- **A new async operation (a new `jobs.Kind`) lands in FOUR
  coordinated places, and the runner's `NewRunner` panics at boot if
  any is missing (issue #249, ADR-0050).**
  1. A new `Kind` constant + `ValidKinds` entry in
     `internal/domain/jobs/jobs.go`.
  2. A migration that ALTERs `job.kind`'s `CHECK` to include the new
     value — the SQLite `CHECK` and the Go enum enforce the same
     closed set, and a `Kind` satisfying one but not the other is a
     silent drop of that class of work.
  3. A handler factory in `internal/domain/controls/jobhandlers.go`
     (mirror `controls.NewReanalyseHandler` / `NewAnalyseHandler` /
     `NewGenerateHandler` / `NewAnnotateHandler` / `NewPublishHandler`,
     the last being the only non-AMC one and therefore the one a new
     non-worker Kind should copy) that translates
     domain sentinels into `jobs.Failure{Message, Detail}` for the
     banner + debug pair.
  4. Its registration in `cmd/server/main.go`'s `jobs.Handlers` map.
  The related operating rule, as ADR-0072 amended it: **the shape of the
  WORK decides, not who it talks to.** An AMC-worker call is async by
  construction, and so is any loop the professor cannot wait on —
  `publish` is the worked non-worker case (forty Gmail calls plus forty
  PDFs off the shared volume, against `httpserver.writeTimeout`'s 30 s).
  A bounded third-party call the professor waits on stays synchronous
  under its own deadline (#271). Concretely: do NOT add a synchronous
  handler that calls `amcworker.Client` from the HTTP goroutine — split the sync half
  from the async half, as `PrepareControl`/`GenerateAssets` and
  `SaveUploadedBatch`/`AnalyzeBatch` already do). ADR-0050 has the
  full reasoning.
- **A worker refusal on the async half leaves the row and files
  intact (issue #249, ADR-0050 §6 — amends ADR-0034 §Failure modes).**
  `GenerateAssets` returning `ErrGeneratorRefused` /
  `ErrSujetMissing` / `ErrGeneratorUnavailable`, and `AnalyzeBatch`
  returning `ErrAnalyzerRefused` / `ErrAnalyzerUnavailable`, MUST
  NOT delete the row or the input files. `source.tex` and
  `pool.json` are the professor's authored artefacts; rolling them
  back on a transient outage would force the professor to
  re-choose the pool. The pre-#249 all-or-nothing promise of
  `Service.Create` is now scoped to the sync half
  (`Service.PrepareControl`). The banner surfaces the failure; a
  future WP adds the explicit retry button. Same rule shape as the
  UploadScan-survives bullet above.
- **Hard-deleting a control requires an ARCHIVED row AND a typed name
  match (issue #261, ADR-0052).** Purge is a two-step gate; a hand-typed
  `/controls/{id}/purge` on an active row must not delete grades. THREE
  independent layers enforce it, and adding a new path to the destructive
  step must respect all three:
  1. `Store.PurgeControl` runs `DELETE FROM control WHERE id = ? AND
     deleted_at IS NOT NULL`. The `AND` is the schema-level belt: even
     if a caller skips the Service gate, an active row is untouched.
     Removing the guard is forbidden.
  2. `Service.Purge` calls `ControlByID` first and returns
     `ErrCannotPurgeActive` if `DeletedAt == nil`. Kept distinct from
     `ErrControlNotFound` so the handler can render "archívalo primero"
     rather than a bare 404 for a URL against an active id.
  3. `handler.Purge` re-validates `confirm_name == control.Name`
     verbatim (no trim, no case fold — the string on the confirmation
     page is what the professor sees, and a match must be what they
     type). Mismatch → 422 re-render, row untouched. And BOTH
     `PurgeConfirm` (the GET) and `Purge` (the POST) refuse an active
     row with 404 before the form is rendered or the delete is
     attempted — the destructive form never surfaces for anything not
     archived.

  Post-DB the on-disk project directory is removed best-effort
  (`os.RemoveAll` warning-not-erroring; §Service.Purge doc). Forwarding
  the FS failure to the caller would leave the professor believing the
  purge failed while every grade is already unrecoverable through the
  cascade — same "best-effort cleanup after the load-bearing commit"
  shape as `PrepareControl`'s rollback.

  Related: the async runner is untouched by soft-delete.
  `SoftDeleteControl` only stamps `deleted_at`; an in-flight job keeps
  running, `MarkDone`/`MarkFailed` still find the row, and the runner
  (#249) has no reason to look at the column. Blocking archive on
  in-flight jobs is a follow-up deferred by design (§Async runner
  interaction). Two rules — the soft-delete two-step and the purge
  three-gate — one bullet.

- **`DismissJob` refuses to stamp `viewed_at` on a non-terminal
  job, and the Detail page hides "Prueba a imprimir" until the
  latest generate reaches `done` (issue #257, Jetson 2026-08-27).**
  Both are one invariant with a single reason: the banner hides the
  moment `viewed_at != nil` on a non-`running` row (`jobBannerFor`
  policy) and the professor never sees the terminal "listo" /
  "falló" signal — Miguel found this on the first live use of the
  #249 runner. Two policies enforce it:
  1. `handler.DismissJob` gates on `job.Status.IsTerminal()`.
     Non-terminal → plain redirect (no stamp). The store's
     `MarkDismissed` stays idempotent; the policy lives on the
     handler where the professor's click happens.
  2. `handler.pdfsReadyFor` reads `jobs.Store.LatestForControlByKind
     (controlID, KindGenerate)`. The template gates the download
     section on the resulting `PDFsReady`. Fallbacks: no generate
     row → TRUE (pre-#249 rows, or direct `PrepareControl` +
     `GenerateAssets` in tests); store outage → TRUE (aid, not
     load-bearing — same policy as `jobBannerFor` which returns
     nil under the same failure).

  A future banner-consumer that needs a "terminal vs in flight"
  check MUST call `jobs.Status.IsTerminal()` — do not restate
  `StatusDone || StatusFailed` inline (issue #257 review, ARQ-2).
  Same rule shape as the UploadScan-survives / LiveBank-survives /
  Reading.Pages two-boundary bullets.
- **A roster import UPSERTS and WITHDRAWS; it never deletes, and it never
  applies a partial answer (issue #271, ADR-0069).** Three invariants, one
  reason each, all in `coursestore.SaveRoster`:
  1. **A student Canvas no longer lists is stamped `withdrawn`, never
     DELETEd.** Their grades hang off the RUT match WP-2 adds, and a
     student who dropped the course still sat the controls they sat.
     Re-appearing in a later import puts them back to `enrolled`.
  2. **The upsert keys on `student.canvas_user_id`, never on `rut`.** The
     RUT is nullable by design (Canvas may hold none), and keying on it
     would insert a second person row for every RUT-less student on every
     import. Two students with no RUT coexist because SQLite lets NULLs
     coexist under a UNIQUE — which is also why the schema refuses the
     empty string that would NOT.
  3. **One person becomes one row however many times the source listed
     them.** Canvas returns a node per ENROLMENT, so a student in two
     sections arrives twice; the dedupe on `canvas_user_id` lives in
     `SaveRoster`, not in the adapter, so a future source (a CSV, another
     LMS) inherits it. Without it the upsert was still correct but the
     per-student `existing` probe saw the enrolment the first pass had just
     created, so the second landed in `Updated` and the flash told the
     professor the class had one more student than it does (#271 review,
     COR-8).
  4. **The whole roster lands in ONE transaction.** A half-applied import
     looks exactly like a class where some students vanished, and the
     professor cannot tell which half arrived. Two different Canvas users
     carrying one RUT abort the whole import rather than resolving it: that
     column is the key grades are matched on, and choosing between two
     people silently delivers somebody's grade to somebody else.

  And above the store: **`Service.Import` calls `SaveRoster` only on a
  successful Canvas answer.** Handing it an empty roster on an outage would
  withdraw the entire class — the silent version of this whole bullet.
  Same rule shape and same reason as the UploadScan-survives and
  LiveBank-survives bullets.
- **A page that is a redirect TARGET consumes the flash (issue #279).**
  `flash.Set` writes a cookie; nothing renders it until a handler calls
  `flash.Consume` and puts it on the page. A handler that sets a flash and
  redirects to a page which does not consume produces a button that works
  in total silence — and leaves the cookie to reappear on some unrelated
  page later.

  It shipped that way: `Courses.Show`, `Courses.List`, `Courses.Students`
  and `Profile.render` never consumed, so EVERY message on `/profile`,
  `/courses` and `/courses/{id}` had been invisible since #271 — the
  roster import's "Lista importada: N estudiantes" included. Miguel found
  it in production by pressing "Reasociar controles" three times and
  getting nothing; the three redirected GETs were byte-identical.

  **Assert the PAGE, not the cookie.** The reason six review lenses and
  ~25 tests missed it is that every flash assertion on this surface used a
  helper reading the cookie off the POST response, which is green whether
  or not a human is ever told. `TestEveryFlashOnTheCourseScreensReaches
  ThePage` is the shape that catches it: POST, follow the redirect
  carrying the cookie a browser would carry, and look for the words in the
  HTML. The other flash tests in this package still measure the cookie
  ([#281](https://github.com/so77id/nalanda/issues/281)).
- **Matching never guesses, and an unanswerable lookup is not an absence
  (issue #272, ADR-0071).** Three parts, one reason each:
  1. `matching.MatchByRUT` returns `(nil, nil)` for everything it cannot
     answer confidently — a RUT it cannot normalise, a control with no
     course, a RUT nobody enrolled carries — and the caller writes NULL so
     the copy stays in the reconciliation queue a human already watches.
     An unmatched copy is a copy somebody looks at; a WRONGLY matched one
     is a grade delivered to the wrong person and nothing downstream
     notices.
  2. **The scope is the control's course only.** `student.rut` is globally
     UNIQUE, so matching a person enrolled ELSEWHERE — or one who withdrew
     from this course — is available and forbidden (AC2). "These digits
     belong to this person" and "this person sat this control" are
     different claims.
  3. **A store error means the question could not be ASKED**, which is not
     "nobody". `controls.matchOne` leaves `reading.student_id` exactly as
     it is and counts the reading in `RematchResult.Errored`; a control
     that could not be walked at all counts in `ControlsFailed`, whose
     unit is CONTROLS, not copies. Folding either into `Unmatched` tells
     the professor a smaller problem than they have (#272 review, ARQ-4).
- **Anything that changes a copy's effective RUT, or a control's course,
  rematches in the SAME operation (issue #272).** The four seams are
  `AnalyzeBatch`, `Reanalyze`, `SaveOverrides` (only when `RUTAction !=
  RUTActionUnchanged`) and `AssignCourse`; the repair path is
  `RematchCourse` / `RematchAllCourses`, reached from
  `POST /courses/{id}/rematch` and `POST /admin/rematch`.

  All of them are BEST-EFFORT after the load-bearing write
  (`rematchQuietly`): the association is recomputable, the read and the
  edit are not. `AssignCourse` is the one that was missed first time —
  stamping the column without rematching left a control reassigned from
  course A to B with every reading pointing at somebody enrolled on A
  (#272 review, COR-3). Last-wins is only safe if the consequences move
  with it. A new path that alters `rut_override`, `rut_read` or
  `control.course_id` without rematching leaves copies filed under people
  the current reading no longer names.
- **The student association ANNOTATES; it never GATES (issue #272,
  ADR-0071 §5).** `estadoFor`, `summarise` and `closeGate` do not read
  `Reading.StudentID`, on purpose: a copy nobody could match is still a
  copy that was read and graded, and blocking *Cerrar corrección* on the
  roster would make a paper flow that has worked since WP-F depend on a
  Canvas import that may not have happened. The association surfaces as
  the "Asociación" badge on the control page (hidden entirely when the
  control has no course), the review page's "no está en la lista" note,
  and `/courses/{id}/matriz` — nowhere else.
- **No value reaches an RFC 5322 header un-neutralised, and `buildMIME` is
  the only place that decides how (issue #273 review, SEC-1 and NEW-6).**
  Three mechanisms, one per kind of value, and a new header picks the one
  that fits rather than inventing a fourth:
  1. **Addresses** (`From`, `To`) — `headerAddress`, which REFUSES a control
     character and then serialises through `mail.Address`. Both halves are
     load-bearing: `mail.Address.String()` alone does not neutralise
     `\r\n\r\n`, measured by mutation in the review.
  2. **Free text** (`Subject`, the attachment filename) — `mime.QEncoding`,
     which encodes everything below U+0020. These are values a professor may
     legitimately write anything into, so they are encoded rather than
     refused.
  3. **Values from a closed set** (the attachment's `Content-Type`, the
     multipart boundary) — refused on a control character, because one there
     is a caller bug rather than user input.

  An earlier version of this rule named only the first two and was violated
  by the very function it governs.
  Interpolating a value into a header with `fmt.Fprintf` is how a CR/LF
  injected a `Bcc:` that Gmail's `message/rfc822` upload honours — sending
  one student's grade and corrected PDF out of the professor's own mailbox
  — and how `net/mail.ParseAddress`'s un-quoting of
  `"a@evil.com,b"@x.com` put two recipients in a header somebody typed one
  address into.

  The guard is at the ENCODER, not at the roster, on purpose:
  `student.email` reaches the header verbatim from Canvas with no
  validation in any layer between, and every future source of an address
  would otherwise need its own copy. Same "one sink, one guard" shape as the
  `escapeBankText` bullet below.
- **Two RUT parsers exist and must stay two (issue #272).**
  `matching.NormalizeRUT` reads eight bare digits as the BODY — what
  `\AMCcode{rut}{8}` prints and what the review field asks for.
  `canvas.SplitSISID` reads the LAST character of `user.sisId` as the
  verifier, measured against the real Canvas in ADR-0069. They look like
  duplicates and are deliberate inverses: deduplicating them shifts every
  AMC reading one digit and matches a different person, silently
  (`11222333` → body `01122233`).
  `TestEightDigitsAreTheBodyUnlikeCanvasSISIDs` is the pin.
- **The LiveBank in-memory snapshot survives every Reload failure
  (issue #230).** Reintroducing a code path that clears the
  `atomic.Pointer[Bank]` on a fetch/parse failure is forbidden — a
  Reload logs `WARN` and returns an error while readers keep seeing
  the last-known-good snapshot. Same rule shape and same reason as
  the UploadScan bullet above; ADR-0032 §Addendum records the
  decision. Both refresh paths call `LiveBank.Reload` — the ticker
  in `bank.LiveBank.Watch` and `handler.AdminBank.Refresh` — and the
  atomicity guarantee is **per-call**, not request-level (a handler
  that resolves `.Get()` then hands the request to the service,
  which also resolves `.Get()`, can straddle a swap; the addendum
  pins that distinction after the WP review flagged it).
- **The empty-`Reading.Pages` fallback for the review page's raw-scan
  section is owned by exactly TWO boundaries (issue #243).** Migration
  `00011_reading_pages.sql` backfills every legacy `reading` row to
  `pages_json = '[1]'`, and `amcworker.toDomain` substitutes `[1]` per
  copy when the wire report omits `pages_per_copy` (a legacy worker).
  `buildReviewImages`, `upsertReading` and `scanReading` **trust** the
  invariant those two boundaries establish and MUST NOT paper over an
  empty list with a third substitution — an empty list at
  `buildReviewImages` means a genuine `not_present` copy reached by
  hand-typed URL, and an empty `Escaneo` section is the honest signal.
  Same rule shape and same reason as the UploadScan and LiveBank
  bullets above; ADR-0031 §"The report says which pages of each copy
  were captured" (amended by #243) is the shipping contract.
- **Bank text destined for the printed sheet MUST go through
  `escapeBankText` (issue #237, further shaped by #239).** The pipeline
  in `internal/domain/controls/tex/tex.go` runs SEVEN ordered stages,
  bracketed by a quarantine mechanism for content the author wants
  literal. Order top-to-bottom, load-bearing at every step (the
  step-by-step "why here" is on `escapeBankText`'s doc-comment):
  1. `extractCodePayloads` — pulls every backtick pair out to a
     `\x00CODE<n>\x00` sentinel BEFORE the emphasis / quote / Unicode
     passes run, so nothing bleeds into `` `code` `` content. Author's
     `` `.equals("María")` `` reaches the sheet as `.equals("María")`
     in monospace, matching MDX's on-screen "backticks are inviolable"
     rule (#239 COR-2, shipped bug in `buscar-con-equals`).
  2. `escapeLatex` — TeX specials in author text.
  3. `mapUnicodeToLatex` — Θ ² √ ≤ → ∞ — … (#237). Runs AFTER
     `escapeLatex` so the `\` and `$` it introduces are not re-escaped.
  4. `boldPattern` — `**text**` → `\textbf{…}`. `\B` gates on BOTH
     outer sides so `n**m` arithmetic never fires as bold (#239).
  5. `mapItalic` — `*text*` → `\textit{…}`. Manual scan, not a regex:
     Go's RE2 cannot express "no `*` on the outside" without lookaround.
     The boundary check (`italicBoundaryOK`) forbids BOTH word chars
     AND another `*` on the outside of a marker, so `n*m*p` arithmetic
     and cross-`**` italic bleed (`n**m es la … 2**3`) are both blocked
     (#239 COR-1).
  6. `mapAsciiQuotes` — `"…"` → `\guillemotleft{}…\guillemotright{}`
     (T1-encoding guillemets). State machine: first quote opens, second
     closes, so on. `[T1]{fontenc}` would otherwise compose a diacritic
     onto the next glyph on a bare `"` (#239). Uses T1 macros directly
     rather than `\og`/`\fg{}` — the babel-spanish shortcuts require
     `activeacute` to be set and produce "Undefined control sequence"
     otherwise (2026-08-27 post-#240 regression).
  7. `restoreCodePayloads` — puts each backtick payload back as
     `\texttt{escapeLatex(mapUnicodeToLatex(payload))}`. Emphasis /
     quote transforms are deliberately NOT re-applied to code content.

  A new path that emits Statement or Alternatives text into `.tex`
  outside `escapeBankText` will let bare Unicode reach pdftex and
  reproduce the exact `auto-multiple-choice prepare failed (1)` #237
  set out to prevent — and now also lets raw `**`, `"` and stray `*`
  leak onto paper as literal markers.

  Extension conventions the pipeline pins (non-negotiable when adding
  a new transform):
  - A new Unicode row goes in `unicodeReplacer` AND a matching row in
    `TestMapUnicodeToLatex_Round2` (`tex_internal_test.go`), one per
    character — the pin against a silent revert.
  - **A new inviolable payload type** (author-controlled content that
    must reach the sheet literally) follows the
    `extractCodePayloads` / `restoreCodePayloads` recipe — sentinel
    swap before the transform pipeline, unwrap after. Do NOT insert a
    new transform in the middle of the chain and hope authors won't
    hit the bleed; #239 COR-2 was that hope, and it printed on paper.
  - **A new emphasis marker** (a `~~strike~~`-shaped rule) needs its
    outer-boundary check to forbid BOTH word chars AND another
    marker-char — worked case: `italicBoundaryOK` in `tex.go`. A pure
    `\B` gate is not enough; #239 COR-1 shows the exact silent-corruption
    failure mode.
  - Author-facing summary lives in
    `docs/standards/guides/write-control-questions.md` §"Unicode
    symbols" and §"Text emphasis" — both get a matching update in the
    same PR (documentation.md Rule 1).
- **The statistics panel is a pure read and every grade flows through
  `controls.NumericGrade` (issue #251) — which is the FLOAT back door, for
  statistics only.** A caller holding a `Reading` and showing a PERSON a
  grade calls `controls.GradeFor` (its own bullet below): `NumericGrade` and
  `FormatGrade` are not a pipeline, and composing them re-scales the grade
  and mails a grade re-scaled by the question count — too high on a short control, too low on a long one (#287).** `internal/domain/controls/stats/`
  computes the panel out of the readings, the current bank snapshot and
  `Control.QuestionsPerCopy` — no writes to the DB, no worker call, no
  cache. The panel is only rendered on `Control.State == Graded` AND
  `Global.N > 0` (a Graded control with no gradeable readings shows no
  panel rather than an empty state). `NumericGrade` is the numeric
  back door of `TotalAndGrade` — both delegate to a single `rawTotal`
  in `grade.go`, and `NumericGrade` maps its return through
  `numericGrade` for the 1.0–7.0 grade. A comment above the pair
  claims the panel and the readings table cannot disagree, and the
  shared core is what makes that true. A future caller that adds a
  second grade computation — a parallel math for "estadísticas
  ponderadas", a hardcoded 4.0 cut in the panel, anything — will
  drift the two silently. The exclusion rules (not_present,
  unreadable RUT without override, doubtful/ambiguous without
  override) are `rawTotal`'s responsibility, not each caller's;
  adding a new "invalid" case belongs there. Same rule shape and
  same reason as the UploadScan / LiveBank / Reading.Pages bullets
  above; the invariants that pin the shared computation live in
  `internal/domain/controls/stats/`:
  `TestPerQuestionAlternativeDistributionSumsToNForSimpleQuestions`
  (`item_test.go`) and `TestCompute40CopyBatchWithMixedStatuses`
  (`coverage_test.go`) — plus `TestPctErradaCountsOKWrongsEvenWith
  Overrides` (`item_test.go`), added after the review caught the
  pre-fix double-subtraction of the override bucket.
- **Only `invalid_grant` throws a stored Gmail credential away (issue
  #273, ADR-0072).** `gmail.Service.AccessToken` clears the sealed refresh
  token and the connected address on `gmail.ErrRejected` and on NOTHING
  else — not on a 5xx, not on a transport failure, not on a 400 that is
  some other OAuth error, and not on a secret that will not unseal (which
  is a wrong master key, a deployment fault, and a row a correct key would
  still open). A Gmail **403** is likewise not a rejection: it covers
  "insufficient permission" AND "daily limit exceeded", Google separates
  them only inside an error `reason` whose vocabulary is not contractual,
  and between deleting a working credential over a quota and leaving a
  broken one for the professor to reconnect by hand, the second is the
  recoverable mistake. The asymmetry is the whole design: clearing too
  eagerly makes a professor reconnect every time Google hiccups, and it is
  unrecoverable in the direction that matters — this server cannot
  re-consent on their behalf.
- **A publication is REFUSED under a transport that does not deliver
  (issue #273 review, ADR-0072 §5).** `Dispatcher.Delivers()` is what the
  domain asks before it stamps anything. Under `stub` or `dryrun` every
  `Send` succeeds, so without it a publication counted forty successes over
  nobody, stamped the control and told the professor the class had been
  written to — on the DEFAULT mode, by the deploy path
  `DEPLOY-JETSON.md` documents. Adding a fifth transport means answering
  this honestly; a wrapper DEFERS to what it wraps (`StagingDispatcher`)
  rather than hard-coding true.

  **The UNDO that used to sit beside this rule is gone (issue #287,
  ADR-0073).** `Service.Unpublish`, `Store.ClearPublished` and
  `POST …/unpublish` existed because publication was one-way, so any run
  that stamped without reaching anybody left the class permanently
  unreachable. Publishing is resumable now, so the dead end cannot happen
  and there is nothing to escape from. What replaced it in the same slot on
  the page is **"Reenviar a todo el curso"** (`Service.ResendToWholeCourse`),
  which is a different thing wearing the same button: a DELIBERATE bulk
  resend for the case the staleness rule cannot see — the annotated PDFs
  were wrong and the grades were not. It clears the stamps and sends
  nothing; the professor presses Publicar afterwards, having read how many
  people would receive a second copy.
- **Each COPY is stamped immediately AFTER its own send succeeds (issue
  #287, ADR-0073 — supersedes ADR-0072 §5).** `Service.Publish` calls
  `Readings.MarkCopyPublished` inside the loop, right after the dispatcher
  accepted that copy's message. Batching the stamps at the end, or stamping
  ahead of the send, is forbidden.

  **The rule this reverses was correct, and knowing why is the point.**
  #273 stamped the CONTROL above the loop, because with no per-copy record a
  crash halfway through a batch is a choice between two failures: stamp
  after and the professor republishes to twenty people who already have
  their grade, stamp before and the un-sent half is unreachable through the
  app. It chose the second, since a duplicate mailing cannot be recalled.
  Migration 00019 gives each copy its own `published_at`/`published_grade`,
  and the choice disappears — a crash costs nothing, because the next
  Publicar sends exactly what did not go out. Anybody re-deriving the #273
  trade-off from first principles will re-introduce it; the per-copy record
  is the premise that makes it obsolete.

  `control.published_at` is still stamped ONCE, on the first run, and a
  resume must not re-date it: "when was this class published" is not a
  question re-sending one copy changes the answer to.

  **A COPY IS STAMPED ONLY BY A RUN THAT REACHED ITS STUDENT, and this is
  the half that was got wrong first (#287 review, COR-1/SEC-1).** Three
  kinds of run put the message in the professor's own mailbox instead: an
  "envío de prueba" to one typed address, a publication in `staging` mode,
  and ANY run under a deployment-wide redirecting transport. `Service.Publish`
  asks `addressesStudents` — a predicate deliberately SEPARATE from
  `rehearsal`, because it gates the per-copy stamp and the resume filter and
  must NOT gate the control-level `MarkPublished`, which is what records the
  EFFECTIVE mode a redirecting deployment has to leave behind (#273's
  DAC-8). It gates BOTH of its two sites: a redirected run also sends the
  whole batch, whatever state each copy is in, because filtering a rehearsal
  would rehearse something other than the thing being rehearsed.

  What testing only `TestTo` cost: a publication in "mi propia dirección
  (prueba)" stamped every copy, so the next real Publicar skipped the entire
  class while the copies table said "enviada". Its worst shape is the case
  this WP exists for — a staging rehearsal on an already-published control
  consumes the one re-corrected copy, and NO screen says "prueba", because
  `MarkPublished` never runs a second time. Adding a fifth transport, or a
  third per-publication mode, means answering "does this reach the student
  the record would claim" as honestly as `Delivers()` answers its own
  question. `PublishOne` carries the same guard.

  A consequence worth knowing before touching `publishedLine`:
  `publication_mode` is written once, so it says `staging` forever after a
  rehearsal-first control. The line therefore asks the COUNT first — a
  stamped copy proves a student was written to — and falls through to the
  mode only when nothing is stamped. **And its zero asserts nothing**: a
  cleared control ("Reenviar a todo el curso") and a publication that
  delivered nothing reach the same zero, and the row cannot tell them
  apart. Wording it as "nadie recibió su corrección" is the "NULL is not
  zero" mistake `00018_published_sent.sql` names, re-entered through the
  derived count (#287 review, COR-2).

  **A test that only checks the end state cannot see either ordering** — the
  loop never returns early, so every order finishes in the same place, and
  #273's first version of that case survived the mutation. The pin asks the
  DISPATCHER what the world looks like at the SECOND send
  (`TestEachCopyIsStampedBeforeTheNextMessageGoesOut`), by which time copy 1
  must already be stamped. Same rule shape as the UploadScan-survives and
  LiveBank-survives bullets.

  **And the per-copy record must survive a re-analysis.** `upsertReading`'s
  `ON CONFLICT DO UPDATE SET` names the columns it overwrites and these are
  not among them. Adding them would make one "re-leer con otra sensibilidad"
  report that nobody had received anything, and the next Publicar would mail
  the whole class a second time.
  `TestUpsertingAReportPreservesThePerCopyPublication` is the pin.
- **A publication skips; it does not fail — and since #287 it says so out
  loud (issue #273, extended by #287).** A copy nobody was matched to, a
  matched person no longer enrolled, a grade that is not defined, a missing
  annotated PDF — all ORDINARY, all counted in `PublishResult.Skipped`. A
  class where two people missed the control is a normal class, and folding
  those into `Failures` reports a problem the professor does not have.
  `Failures` is what they are asked to ACT on: a send that was attempted and
  refused, with the copy number and a reason. Same distinction, and the same
  reason, as #272's Unmatched / Errored / ControlsFailed split.

  `Skipped` was a number nobody could see for the whole of #273's life,
  which left the professor comparing "salieron N correos" against their own
  class list. Since #287 the copies table renders the reason per copy, and
  the loop grew a fourth outcome: `AlreadySent`, copies skipped because
  their student already holds the current correction. Keep the two apart —
  Skipped is "nobody got this and here is why", AlreadySent is "this one is
  finished", and it is what makes pressing Publicar twice safe rather than a
  mistake to refuse.

  **ONE function decides deliverability**, `controls.deliverableCopy`, and
  both the screen (`CopyPublicationFor`) and the loop (`messageFor`) go
  through it. A page offering "Enviar" for a copy the publication would
  skip, or a loop skipping one the page called ready, is two answers to one
  question — the shape #251's cannot-disagree rule refuses. The four states
  it feeds are DERIVED on every render, never stored: a fifth column would
  need invalidating on every re-read, re-annotation, override and roster
  import.

  And a copy with no annotated PDF is skipped rather than sent without it:
  "adjunto la corrección" with nothing attached is worse than no message,
  because the student now has to ask.
- **A synchronous route imposes its OWN deadline, and the transport's is
  not one (issue #287 review, ARQ-1).** `handler.copyPublishDeadline` is
  25 s against `httpserver`'s 30 s `WriteTimeout`, beside `importDeadline`'s
  20 s and for the same reason `add-a-backend-endpoint.md` gives: Go's write
  deadline neither aborts a handler nor cancels `r.Context()`. The trap here
  was that the transports underneath ARE bounded — 60 s on the Gmail client,
  10 s on the token refresh — which reads like a bound and is not one: the
  handler outlives the professor's connection, the send completes, the copy
  is stamped, and the professor is told nothing. They press again and the
  student gets two identical messages.
- **Every grade a person reads goes through `controls.GradeFor` (issue
  #287).** `NumericGrade` and `FormatGrade` are NOT a pipeline, and reading
  their names as one is how #273's message builder shipped
  `FormatGrade(NumericGrade(…))`: `NumericGrade` already returns the 1,0–7,0
  grade and `FormatGrade` maps a RAW TOTAL onto that scale, so the second
  re-scaled the true grade as though it were a raw score out of the control's question count. The direction of the error
  depends on the question count: on a SHORT control the emailed grade is too
  high and saturates at 7,0 (a copy with 1 of 2 correct read 4,0 in the
  readings table and was EMAILED 7,0); on a LONG one it is too LOW — a real
  7,0 arrives as 5,2 on a ten-question control, and a real 5,0 as 4,0. Only
  `g = Q/(Q−6)` lands right by accident, and on six questions or fewer
  nothing does. It went to a real class on 2026-09-08. `NumericGrade` is the float back
  door for the statistics panel and `FormatGrade` is the raw-total renderer;
  neither is "the grade of this reading", which is what a caller holding a
  `Reading` wants. That is `GradeFor`, and it is what makes the comment
  above `rawTotal` true. Same shared-core rule as the statistics bullet
  above.
- **`staging` refuses; it never falls back to the student (issue #273).**
  `email.StagingDispatcher` returns `ErrNoStagingRecipient` when
  `Message.ProfessorEmail` is empty. Sending to `msg.To` there would
  deliver to the student in the mode selected to make that impossible, on
  the run where somebody was deliberately being careful. Failing the send
  is recoverable; delivering it is not. Verified by mutation, not by
  reading.
- **The two OAuth flows must stay unable to complete each other (issue
  #273).** The login and the Gmail grant have separate state cookie names
  (`middleware`-adjacent `handler.StateCookieName` vs
  `handler.GmailStateCookieName`) and separate `oauthstate.Store`
  instances. Sharing either half would let a nonce issued for one grant be
  spent on the other, and the two grants carry different scopes. Both
  directions are pinned; read and write those cookies ONLY through their
  helpers, the same rule the session cookie carries.
- **`NALANDA_EMAIL_MODE` defaults to `stub` (issue #273).** It is the only
  optional variable in `config` whose default is not what production wants,
  and reversing it is forbidden. A publication is REFUSED under a
  non-delivering transport, so an operator who deploys without choosing
  finds out the first time they press "Publicar"; one who got `real` finds
  out when a class receives mail that cannot be recalled. An unknown value fails the boot naming the
  legal set and never falls back — a typo resolving quietly to `stub` is a
  professor pressing "Publicar", reading a success message, and nobody
  receiving anything.
- **Nothing here can test the mail path, either (issue #273).** The suite
  drives an `httptest` provider and an `httptest` stand-in for Gmail's send
  endpoint. What no test can see: whether the real consent screen grants
  the scope, whether the redirect URI matches character for character,
  whether a refresh token survives a week, and whether a message this
  server considers well-formed arrives readable in a real inbox. Any change
  to `internal/infra/oidc/gmail.go`, the `/profile` connect flow,
  `internal/infra/email/`, the message builder, `NALANDA_EMAIL_MODE` — or,
  since #287, anything that decides WHICH copies go out or stamps them
  (`Service.Publish`'s resume filter, `Service.PublishOne`,
  `ResendToWholeCourse`, `controls.deliverableCopy`, and the
  `published_at`/`published_grade` writes; §5c and §5d are their steps) — is
  unfinished while a human has not run
  [`GMAIL-CHECK.md`](GMAIL-CHECK.md). Same rule, and the same reason, as
  the Google, Canvas and paper bullets.
- **The two surfaces do not share an auth gate** (§C12). Everything auth-shaped
  is mounted inside `internal/app/web`; `internal/app/api` is anonymous by
  construction, and `/health` sits deliberately outside the gate because the
  container healthcheck carries no cookie. Both directions are asserted in
  `cmd/server/main_test.go` — mounting the middleware one line higher compiles
  and passes everything else in the module.

## Testing protocols

Registered in `docs/standards/testing-strategy.md` (the two-protocol rule).

- **Per-commit**: `gofmt -l .` (must print NOTHING — it exits 0 either way, so
  the status is not the gate), then `go vet ./...`, `go build ./...`,
  `go test ./...`.
- **Pre-PR**: NOT restated here. Run it line by line from
  `docs/standards/testing-strategy.md` §`apps/server`, which is its one home —
  this bullet used to be a copy and had already lost `govulncheck` and the
  `/api/health` probe, so an agent following the file it was told to read failed
  CI on a gate no document it read mentioned (#150 review, AGR-4). It is longer
  than the per-commit one and ends in Docker.

**`-count=1` is not decoration** — see the cache note above. **And the image is
RUN, not only built**: the suite cannot see whether the binary starts on
`scratch`, whether UID 65532 can write the volume, or whether the healthcheck
the compose file names exists in the image. That last one did not, once (#149
S6).

Green means exit status 0, with the `gofmt` exception.
