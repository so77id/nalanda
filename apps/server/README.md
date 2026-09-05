# apps/server — the Nalanda backend

One Go binary serving **two delivery surfaces** over one shared domain: the
professor's server-rendered backoffice and a JSON/WebSocket API for anonymous
students (ADR-0034). SQLite is its database, embedded migrations are applied at
boot, and the production image is a static binary on `scratch`.

Today it starts, reaches its database, answers `/health`, and lets a professor
sign in with Google (ADR-0009, ADR-0036). The screens they would then use are
still to come — see [What is not here yet](#what-is-not-here-yet).

## Stack

| | |
|---|---|
| Language | Go — the authoritative version is [`go.mod`](go.mod), and this table deliberately does not repeat it. Two places are kept in step with it on purpose: `backend-code-style.md` §Version, which quotes the current patch and says why, and the Dockerfile's pinned builder |
| Database | SQLite via `modernc.org/sqlite` — pure Go, no CGO (ADR-0007) |
| Migrations | `github.com/pressly/goose/v3`, embedded, applied at boot |
| Routing | `net/http.ServeMux` — no router dependency |
| Logging | `log/slog`, structured, to stderr |
| Tests | `testing` + `net/http/httptest` — no framework |

Those two are the **entire** direct dependency set, and adding to it is a PR
discussion (root `CLAUDE.md`). Rules for writing code here:
[`docs/standards/backend-code-style.md`](../../docs/standards/backend-code-style.md).

## Configuration

Environment variables, read once at boot. A required variable that is absent
**or empty** is a startup error naming it — never a silent default. Copy
[`.env.example`](.env.example), which is the full contract:

| Variable | Required | What |
|---|---|---|
| `NALANDA_ADDR` | yes | Bind address, `host:port` |
| `NALANDA_DATABASE_URL` | yes | Path to the SQLite file |
| `NALANDA_LOG_LEVEL` | no (`info`) | `debug`, `info`, `warn` or `error`. Since #228 every HTTP request is logged at INFO across both surfaces (backoffice + api), one line with method, path, status and duration_ms; `/health` is at DEBUG on purpose so the container healthcheck stays out of the operator's view. The OAuth callback path is logged without its `code`/`state` query — those are one-shot credentials (RFC 6749 §10.3). Middleware: `internal/app/web/middleware/requestlog.go` |
| `NALANDA_PUBLIC_URL` | yes | Base URL the server is reached at — scheme, host, optional port, and **no path**. The OAuth redirect URI is built from it and its scheme decides the cookie's `Secure` flag; a base carrying a path would build a redirect URI these routes do not serve, so it is refused at boot |
| `NALANDA_GOOGLE_CLIENT_ID` | yes | The Google OAuth client (ADR-0009) |
| `NALANDA_GOOGLE_CLIENT_SECRET` | yes | Its secret. Never printed: `config.Config` redacts it for both `fmt` and `slog` |
| `NALANDA_SESSION_TTL` | no (`720h`) | Session lifetime, as a Go duration. Zero or negative is a startup error |
| `NALANDA_BOOTSTRAP_PROFESSOR_EMAIL` | no | On a database with **no** professors, the first Google login by this address creates one. Inert as soon as any professor exists |
| `NALANDA_TRUST_PROXY_HEADERS` | no (`false`) | `true` when a trusted reverse proxy owns `X-Forwarded-For` — the Jetson deploy (#162) behind Tailscale Funnel. The sessions table's IP column then comes from the FIRST hop of the header instead of `RemoteAddr` (loopback for every visitor there). Only `true`/`false`; a misspelling is a startup error |
| `NALANDA_QUESTIONS_JSON_URL` | yes | The published question bank (ADR-0032). `http://`, `https://` or `file://`. Fetched at boot AND polled at `NALANDA_BANK_REFRESH_INTERVAL` cadence (issue #230, ADR-0032 §Addendum). A parse failure **at boot** is a startup panic; a failure **on a subsequent refresh** logs `WARN` and preserves the last-good snapshot — the server never nils the pointer. WP-E |
| `NALANDA_AMC_WORKER_URL` | yes | The AMC worker's HTTP origin, e.g. `http://amc-worker:8080` in compose. Absolute http/https URL, no path. WP-E |
| `NALANDA_WORK_DIR` | yes | Where the server sees the shared volume. The `.tex` generator emits `/work` absolute paths regardless (that is the worker's mount); this only decides where the server writes its files. WP-E |
| `NALANDA_MAX_SCAN_MB` | no (`100`) | Largest scan PDF the upload handler accepts, in whole MB. A 4-page control at 300 dpi is roughly 3–5 MB; 100 fits a large class and refuses a runaway upload before it enters the worker. WP-F |
| `NALANDA_ANNOTATE_ENABLED` | no (`true`) | The annotate loop's master switch (issue #190). `false` turns the whole flow off: no `/annotate/copy` calls, no `annotated_copy` rows, the review page serves the raw scan — the escape hatch if the AMC-patching approach breaks against a real batch. Only `true`/`false`; a misspelling is a startup error |
| `NALANDA_BANK_REFRESH_INTERVAL` | no (`5m`) | How often LiveBank polls `NALANDA_QUESTIONS_JSON_URL` for a fresh `questions.json` (issue #230). A Go duration; matches the Watchtower poll cadence on the Jetson so the server refreshes at the same rhythm as the container. `0s` disables the ticker — the manual admin button is then the only refresh path. A negative value is a startup error |
| `NALANDA_SECRETS_MASTER_KEY` | no | The AES-256 key sealing `user_secrets` — today the professor's Canvas API token (issue #271, ADR-0068). Base64 of exactly 32 bytes (`openssl rand -base64 32`). **Absent or empty is legal**: the server boots and the Canvas integration reports itself unconfigured, so a deploy that has not been given a key yet stays up instead of refusing to start (the Jetson restarts within five minutes of a merge, ADR-0038 — a required variable here would take production down in that window). **Present but not 32 bytes after decoding is a startup error** naming the variable; a typo must not read as "not configured". Never printed: `config.Config` reports only whether it is set. WP-1 of epic #270 |
| `NALANDA_CANVAS_GRAPHQL_URL` | no | The Canvas GraphQL endpoint the roster import talks to (issue #271). Empty uses the client's own default, `https://udp.instructure.com/api/graphql` — the literal lives on `canvas.Client` so it is written once. When it **is** set it must be an absolute http/https URL, and **plain `http` is refused unless the host is loopback**: the Canvas token travels in an `Authorization` header on every profile load and every import, so `http://` to a real host would put a full-permission credential in clear from nothing worse than a typo (#271 review, SEC-2). A malformed value is a startup error rather than a failure on the first professor who pastes a token |

## Commands

Run from `apps/server/`.

```bash
# Run it, against a database in this directory (gitignored). All five below are
# required: the server refuses to start naming whichever is missing, rather than
# starting into a login nobody could complete.
NALANDA_ADDR=127.0.0.1:8081 \
NALANDA_DATABASE_URL=./nalanda.db \
NALANDA_PUBLIC_URL=http://127.0.0.1:8081 \
NALANDA_GOOGLE_CLIENT_ID=placeholder.apps.googleusercontent.com \
NALANDA_GOOGLE_CLIENT_SECRET=placeholder-secret \
  go run ./cmd/server

# Placeholders are enough to boot and to serve /health. A real login needs real
# values: copy .env.example to .env and follow GOOGLE-CHECK.md.

curl -s http://127.0.0.1:8081/health      # backoffice surface
curl -s http://127.0.0.1:8081/api/health  # API surface

# Verify. The two protocols are defined in docs/standards/testing-strategy.md;
# this is the per-commit one. Note the `test -z`: `gofmt -l` PRINTS the files it
# objects to and exits 0 either way, so a bare `gofmt -l . && …` chain reads
# like a gate and is not one.
test -z "$(gofmt -l .)" && go vet ./... && go build ./... && go test ./...

# Build the production image (16.4 MB, measured 2026-08-26 on darwin/arm64:
# `docker image inspect nalanda/server:dev --format '{{.Size}}'` = 16366935).
# It was 10.3 MB before #150 added the auth domain, the OIDC client and an
# embedded template; 12.2 MB after #150. #231 embeds ~3 MB of vendored PDF.js
# (pdf.mjs + pdf.worker.mjs, see internal/app/web/static/vendor/pdfjs/) for
# the annotated-PDF viewer on the review page — ADR-0047. The figure is
# reported, never gated — a test that reddens because a number moved teaches
# nothing (ADR-0034 §Consequences).
docker build -t nalanda/server:dev .
```

### With Docker

Local orchestration lives in `infra/local/`, not here — it coordinates services
and belongs to none of them (`repository-structure.md` §Placement criteria). The
app still packages itself: the `Dockerfile` is in this directory.

```bash
cd ../../infra/local

# --build is load-bearing: compose reuses the tagged image, so without it this
# runs whichever binary was tagged last — which in #150 was a stale one that
# passed the check while missing the change under review.
docker compose up -d --build --wait server   # --wait means "the database answers"
curl -fsS http://127.0.0.1:8081/health
docker compose logs -f server
docker compose down                       # add -v to discard the database too
```

`--wait` is meaningful because the container has a healthcheck, and the
healthcheck is the binary itself: `/server -health` probes `/health` and exits
non-zero unless it answers 200. The image is `scratch` — no shell, no curl, no
wget — so the only executable a healthcheck can invoke is the server.

## Layout

```
cmd/server/        wiring and entry point — the only main package
internal/domain/   business types and the interfaces they need — PURE
  auth/            professors, identities, sessions, and who may log in
  controls/        the entrance-controls domain: create/upload/read pipeline
  course/          course + bank types (LiveBank, sections, questions)
  health/          the /health prober seam
  jobs/            the async job runner (issue #249, ADR-0050): types +
                   single-goroutine Runner
internal/app/web/  the professor's backoffice
  handler/         the login round trip and the professor CRUD
  middleware/      cookie → professor, the gate, CSRF, and the surface-agnostic request log
  oauthstate/      the single-use state nonces of the OAuth flow
  flash/           the one-shot POST/redirect/GET message cookie
  view/            html/template, embedded — shell + pages
  static/          vendored front-end assets (PDF.js today), embedded via
                   //go:embed and served under /static/ (ADR-0047). New
                   libraries land under vendor/<lib>/ with their own README
                   (source, version, SHA-384, upgrade recipe).
internal/app/api/  the JSON/WS surface — anonymous, no middleware (§C12)
internal/infra/    adapters: config, storage, httpserver, httpjson, selfcheck
  amcworker/       the AMC worker HTTP client (with generateLock mutex)
  oidc/            the Google client — standard library, no OIDC dependency
  storage/authstore/     the SQLite side of the auth domain
  storage/controlstore/  the SQLite side of the controls domain
  storage/jobstore/      the SQLite side of the jobs domain (issue #249)
migrations/        goose SQL migrations, embedded into the binary
```

**Three dependency edges, all enforced** by `internal/architecture_test.go`,
which walks the package graph and fails on a violation, transitive ones
included:

1. `internal/domain` imports neither `internal/app` nor `internal/infra`, nor
   any third-party package.
2. `internal/infra` does not import `internal/app` — adapters sit beneath the
   surfaces, not beside them.
3. Neither delivery surface imports the other.

When the domain needs something from outside it declares an interface and infra
implements it — `health.Prober`, implemented by `storage.Prober`, is the worked
example. Full statement: `docs/standards/backend-code-style.md` §The dependency
rule.

## `/health`

Answers `200` only when the process is up **and** a query against the database
succeeds; otherwise `503`. Both surfaces serve it, at `/health` and
`/api/health`.

A check that only proves the HTTP listener accepted a connection lies exactly
when it matters, which is why the database half exists.

**The two surfaces differ in one field, on purpose.** `/health` is the
backoffice's, read by an operator, and carries the cause; `/api/health` is
anonymous, reached from students' browsers, and reports the verdict without it.
Today the withheld string is harmless SQLite text, but the field will hold a
Postgres DSN after ADR-0007's swap — `failed to connect to host=… user=…`. This
asymmetry is also the first concrete thing `internal/app/api` exists to express.

`/health` — the professor's backoffice:

```json
{ "process": "up", "database": "up" }
{ "process": "up", "database": "down", "error": "sql: database is closed" }
```

`/api/health` — anonymous:

```json
{ "process": "up", "database": "up" }
{ "process": "up", "database": "down" }
```

## The backoffice

Since WP-C3 (#151) the shell exists and holds the professor CRUD. Every page
renders through one layout (`view/templates/layout.html`) with a two-half
navigation — sections on the left, the professor's own `<details>`/`<summary>`
menu on the right holding the POST logout. Both themes come from
`color-scheme: light dark` and `currentColor`; no stylesheet is served
(§C13 — the backoffice is an internal tool and does not follow ADR-0026).

Since WP-E (#166) the shell also holds the entrance-controls screens: a
professor picks a section range from the published question bank, gets a
printable `sujet.pdf` back, and every control is persisted with its pool
and its per-copy identity. `apps/amc-worker` is the compilation engine
(ADR-0030) and `questions.json` (ADR-0032) is the input.

Since issue #190 the cycle CLOSES with an artefact per copy: an annotated
PDF drawn by AMC that reflects the professor's corrections (ADR-0048). It
is generated automatically for clean copies after an upload and re-generated
on every review save; the review page renders it and falls back to the raw
scan while none exists. `NALANDA_ANNOTATE_ENABLED=false` switches the whole
loop off. Closing a correction fires the `OnCorrectionClosed` hook — today a
no-op logger, tomorrow the seam email/Canvas integrations hang off.

Since issue #231 the review page renders the annotated PDF through
**PDF.js** (ADR-0047), not the browser's built-in viewer: a `<div
id="pdf-viewer">` gets one `<canvas>` per page from an inline ES module
that imports the vendored library from `/static/vendor/pdfjs/`. Browsers'
built-in PDF viewers disagreed on pagination (Brave rendered page 1 only
after PR #227 shipped `<embed>`), and the canvas render keeps every
browser out of the disagreement. A page-N render failure preserves the
pages 1..N-1 that already drew, appends a Spanish error paragraph, and
the "Abrir en otra pestaña" link below the viewer remains as fallback.
`<noscript>` covers the JS-off case. First inline browser script on the
backoffice — the rules for adding another live in ADR-0047 §4.

Since issue #197 one darkness-threshold pair travels with every control
(ADR-0041): the upload and reanalyse forms set it (defaults 0.15/0.05, the
X-friendly pair measured on a real batch), and the same `ticked` drives the
reader, AMC's `note` and the annotated PDF — marks, scores and the drawn
sheet always agree.

Since issue #251 a closed correction grows a statistics panel on
`/controles/{id}`: the professor sees N rendidos vs Y copias, class
globals (promedio / mediana / moda / desviación / mín-máx-rango, %
aprobación / excelencia / reprobación grave — Chilean floors at 4.0 /
6.0 / 3.0 hardcoded for V1), a histogram binned by decimals, a Tukey
boxplot with outliers, and per-question item analysis (dificultad,
alternative distribution A/B/C/D/E, point-biserial discrimination,
% blanco vs % errada). The panel is pure read — no writes, no worker
call, no cache — and every grade flows through `controls.NumericGrade`
so the panel and the readings table cannot disagree. It renders ONLY
when `Control.State == graded` AND at least one reading has a defined
grade; the SVG chrome is inline `currentColor` and lands in both
themes without a stylesheet, matching the rest of the backoffice.

Routes today:

| Route | What |
|---|---|
| `GET /` | Redirects to `/controls` (an anonymous request lands in `/login` first, via the gate). Superseded #151's redirect to `/professors` when WP-E landed |
| `GET /controls` | The list, ordered by application_date desc with nulls last |
| `GET /controls/new` · `POST /controls` | Pick a section range; POST prepares the row + input files synchronously and enqueues a `generate` job for the worker call. The professor lands on the detail page with the banner showing "Procesando generación…" until the runner finishes (issue #249) |
| `GET /controls/{id}` | Detail: metadata, PDF downloads (gated on the latest generate job reaching `done` — hidden while queued/running/failed since #257, so no button 404s), the Escaneos upload form, the Resultados table, (after upload) the *Cerrar corrección* button, and (once graded) the statistics panel — globals, histogram, boxplot, item analysis (issue #251) |
| `GET /controls/{id}/sujet.pdf` · `GET /controls/{id}/corrige.pdf` | Streamed from the shared volume |
| `GET /controls/{id}/pool.json` | The pool snapshot written at Create time (issue #198) — attachment |
| `POST /controls/{id}/scans` | Multipart PDF upload — writes the PDF to disk synchronously, then enqueues an `analyse` job. The runner hands the file to the worker's `/analyse`, persists the report and the pair, annotates clean copies and flips the state to `in_review`. Detail page's banner surfaces the running/done/failed state (issue #249) |
| `POST /controls/{id}/reanalyze` | Enqueues a `reanalyse` job: the runner re-reads the stored captures at new `ticked`/`unsure` thresholds without a new capture, re-scores at them, and re-annotates the clean copies (issue #197, async since #249) |
| `POST /controls/{id}/close` | Moves the control to `graded` when every failure kind is resolved (WP-F S8), then fires `OnCorrectionClosed` (issue #190), then enqueues an `annotate` job as a defensive re-annotate pass (issue #249) |
| `POST /jobs/{id}/dismiss` | On a TERMINAL job (`done`/`failed`), stamps `viewed_at` and redirects back to the control's detail. On a still-running job (`queued`/`running`) it is a plain redirect — no stamp, so the eventual done/failed banner is never pre-muted (issue #249, terminal-only narrowing in #257). The "Refrescar" / "Cerrar aviso" button on the banner posts here |
| `POST /controls/{id}/archive` | Soft-delete: stamps `deleted_at`, redirects to `/controls`. The row disappears from `/controls`; every downstream row (readings, jobs, PDFs) stays. An in-flight async job for this control keeps running because nothing about its row moves. Reached from the "Zona peligrosa" section on the detail page (issue #261, ADR-0052) |
| `POST /controls/{id}/restore` | Clears `deleted_at` and redirects to `/controls/{id}`. Idempotent guard: an already-active row returns "ya estaba activo" and lands on the detail anyway (issue #261, ADR-0052) |
| `GET /controls/archived` | Lists archived controls ordered by `deleted_at DESC, created_at DESC` — most recently archived first, deterministic on same-second batches. Each row surfaces Ver / Restaurar (inline POST) / Eliminar permanentemente (link to the confirmation page) (issue #261, ADR-0052) |
| `GET /controls/{id}/purge/confirm` · `POST /controls/{id}/purge` | Two-step hard delete. The GET renders the confirmation page (404 on an active control — the destructive form never surfaces for anything not archived). The POST refuses unless `confirm_name` matches `control.name` verbatim, and Service.Purge then deletes the row + FK cascade + `os.RemoveAll` the project directory best-effort. 422 on a name mismatch re-renders the page with the typed value echoed back; 303 to `/controls/archived` with a flash on success. The three-gate design (schema `AND deleted_at IS NOT NULL`, Service `ErrCannotPurgeActive`, handler `confirm_name` verbatim) lives in ADR-0052 §2 (issue #261) |
| `GET /controls/{id}/copies/{copy}/review` · `POST` | Split view — corrected PDF (or raw scan) + editable form; POST saves overrides through `answer_override` / `rut_override` and re-annotates the copy |
| `GET /controls/{id}/copies/{copy}/page/{n}` | Streams the scanned page image from the shared volume |
| `GET /controls/{id}/copies/{copy}/annotated.pdf` | Streams the corrected PDF from the shared volume; 404 while none exists (issue #190) |
| `GET /controls/{id}/uploads/{batch}.pdf` | Downloads an uploaded scan batch (`batch-N.pdf`) from the shared volume; the detail page links every batch (issue #204) |
| `GET /static/vendor/pdfjs/pdf.mjs` · `GET /static/vendor/pdfjs/pdf.worker.mjs` | Vendored PDF.js served by the `static` package. Public (issue #231, ADR-0047) — a browser fetching an ES module over a stale session would 302-redirect to login HTML the browser then refuses as JS. Directory-shaped requests answer 404 (no listing, no bare-name redirect); anything else under `/static/` that is not on the embed list is 404 too |
| `GET /profile` | The professor's own account, reached from their menu in the bar. Once a token is stored it also lists the professor's Canvas courses, most recent term open and the rest behind a `<details>` — `allCourses` returns every course they have ever been enrolled in (16 for the professor measured in #271 S4, back to 2020), and the one they want is the current semester's (ADR-0069 §Decision 5). Today it holds the Canvas integration: the empty state with the instructions for generating a token, "Token configurado" with a Reemplazar form once one is stored, or — on a deployment with no `NALANDA_SECRETS_MASTER_KEY` — an explanation naming the variable instead of a form. The stored token is never rendered back (issue #271, ADR-0068) |
| `POST /profile/canvas-token` | Verifies the pasted token against Canvas, then seals and stores it. One route for the first token and for a replacement — the store upserts. A token Canvas refuses is a 422 with a field error and nothing stored; a Canvas that cannot be reached is a 422 that says so and stores nothing either, because an outage is not evidence about a token (issue #271) |
| `POST /profile/canvas-token/forget` | Removes the stored token. Idempotent all the way down (issue #271) |
| `GET /courses` | The courses whose roster lives here, with each one's enrolled count. A course nobody has imported yet reads "sin lista" rather than "0 inscritos" — zero students and no roster at all are different situations and a bare number cannot say which (issue #271) |
| `GET /courses/{id}` | One course and its people, **sorted with accents folded** — SQLite's BINARY collation put every accented surname after every unaccented one, so `ÁVILA MUÑOZ` came after `ZUNIGA PEREZ` (#271 review, COR-7); the rule lives in `roster.SortEnrollments`, not in the SQL. Surname, given names, RUT (formatted with its verifier, `11.222.333-5`), address, and enrolled/withdrawn. A student Canvas held no RUT for shows a dash and is counted on the page — the import flash says it once and is gone, this does not. Withdrawn students stay visible and marked, because they are not deleted. With no roster the page IS the "Cargar desde Canvas" button; with one it offers "Reimportar desde Canvas" (issue #271, ADR-0069) |
| `POST /courses/{id}/import-canvas` | Fetches the course's roster from Canvas and applies it: new students inserted, existing ones refreshed, and anyone Canvas no longer lists stamped `withdrawn`. Only `active` and `invited` Canvas enrolments count as on the course — a `completed`, `inactive` or `deleted` one is a person the import leaves out, which is what lets the withdraw step stamp them (#271 review, COR-5). One person listed twice by Canvas (two sections, or a page boundary over a shifting set) becomes one enrolment and counts once (COR-8). The whole import carries a 20-second deadline, below the server's own write timeout, because `WriteTimeout` neither aborts a handler nor cancels its context — without it a slow Canvas would commit a roster into a connection nobody is listening to (PER-1) — never deleted, because their grades hang off the RUT match in WP-2 and a student who dropped still sat the controls they sat. Idempotent: running it twice yields the same state. The whole roster is applied in ONE transaction, so a failure leaves the previous one intact rather than half-applied. Synchronous rather than an async job (ADR-0050's rule is about the AMC worker, whose operations take minutes; a roster is a handful of GraphQL round trips over a class of tens, and the client's own timeout bounds it). The flash reports added / updated / withdrawn, and warns separately about students Canvas has no RUT for — the outcome that looks like success and is not (issue #271, ADR-0069) |
| `POST /profile/courses` | Creates the `course` row for one of the professor's Canvas courses. The form posts **only** the Canvas id; name, code and term are looked up in the professor's own Canvas listing, so a hand-typed request cannot invent a course or name one course while carrying another's id. Adding the same course twice says so and stays at one row — the schema's `UNIQUE (canvas_course_id)` is what decides, with no preflight SELECT to race against (issue #271) |
| `GET /professors` | The list: address, name, state, created, last sign-in |
| `GET /professors/new` · `POST /professors` | Create by address and name — the `Authenticate` path (2) round trip |
| `GET /professors/{id}/edit` · `POST /professors/{id}` | Rename. The address is not editable |
| `POST /professors/{id}/deactivate` | Flips `is_active=0` and ends every session that professor holds |
| `POST /professors/{id}/reactivate` | Flips `is_active=1` and clears `deactivated_at` |
| `POST /admin/bank/refresh` | Reloads the in-memory question bank from `NALANDA_QUESTIONS_JSON_URL` and redirects back to `Referer` (or `/controls` on empty / off-origin / scheme-relative-path). Session-gated + CSRF. The "Recargar banco" button on the `/controls` index posts to it (issue #230, ADR-0032 §Addendum; issue #254 moved the button out of the navbar) |
| `GET /login` · `GET /login/google` · `GET /login/google/callback` · `POST /logout` | The login round trip — see §Signing in |

Every state-changing route sits behind `middleware.RequireProfessor` AND
`middleware.VerifyCSRF`, both enforced by
`TestEveryRouteIsGatedUnlessItSaysWhyNot` and
`TestEveryStateChangingRouteVerifiesCSRF` walking the router's table. 404,
403 and 500 render through the shell (`view.RenderError`) rather than as
Go's default text.

Two guards enforce that the backoffice cannot be locked shut, both in
`domain/auth/admin.go`: a professor cannot deactivate themselves, and the
last active professor cannot be deactivated. Both refuse in Spanish, as a
flash + redirect rather than a 4xx.

The address is deliberately NOT editable and there is NO delete — a
mistyped address is permanent debt, recorded and accepted in issue #151
§Notes with the fix that would close it (allow delete or re-address on
professors who have never signed in) when it earns its turn.

## What is not here yet

Deliberately, and each with an owner:

| Missing | Arrives with |
|---|---|
| A course row linked to a `control` — the controls still have no `curso_id` | WP-2 of epic #270 (#272). The `course` / `student` / `enrollment` tables themselves landed with #271 |
| JSON contracts, CORS, WebSocket on `/api` | with a consumer (ADR-0008) |
| A per-control upload quota (batches per control, or total bytes) — today `NALANDA_MAX_SCAN_MB` bounds ONE upload | when an operator wants a ceiling on abuse by an authenticated professor |
| Publishing grades (CSV export, Canvas, email) | WP-G |
| Bulk download of annotated PDFs as a ZIP | when the pile is large enough — captured in #167 §Notes |
| Regenerating the annotated PDF after a manual override | #167 §Non-goals; the annotated stays a view of what AMC read, overrides live in the DB |
| Matching a reading's RUT to a student, and any student name on a control screen | WP-2 of epic #270 (#272) — #271 loads the roster and deliberately changes no control screen |
| Isolation between professors | V2 / #163 |
| Deleting or re-addressing a professor who has never signed in | WP that reopens the mistyped-address debt (#151 §Notes) |
| An audit trail of who did what | The WP that gains a second class of actor (#151 §Non-goals) |

`migrations/00001_init.sql` was the deliberately empty placeholder #149 shipped,
and **#150 deleted it** with the first real migration, as planned. The auth
schema is numbered `00002` even so: goose keys applied migrations by version, so
a file reusing number 1 would be considered already applied by every checkout
that had run the server, and the schema would never arrive. WP-C3 added
`00003_last_login_at.sql`. WP-E (#166) added `00004_controls.sql` with the
three tables the controls domain reads (`control`, `control_pregunta`,
`copia`); WP-F (#167) added `00005_readings.sql` with the four the
reading half needs (`reading`, `answer`, `answer_override`,
`rut_override`).

## Signing in

The backoffice is professor-only (ADR-0009): students read the course anonymously
and never get accounts. Four routes make up the round trip, all on the backoffice
surface and none on `/api/` (§C12):

| Route | What |
|---|---|
| `GET /login` | The page. Signed-in professors see it re-rendered through the shell too — a link back into the backoffice |
| `GET /login/google` | Starts the flow: issues a state nonce, redirects to Google |
| `GET /login/google/callback` | Completes it. Refuses a state that is not in this browser's own cookie, and then one this server never issued — both before spending the code (ADR-0036; the cookie half is what closes login CSRF) |
| `POST /logout` | Ends the session. Requires a professor **and** the session's CSRF token |

There are exactly three ways in, and everything else is refused: an already
linked Google identity; a professor who exists with that **verified** address,
whose identity is linked on their first login; or — on a database with no
professors at all — the address in `NALANDA_BOOTSTRAP_PROFESSOR_EMAIL`. Details
and the reasoning: [ADR-0036](../../docs/decisions/0036-the-professor-session-is-ours-and-costs-no-dependency.md).

**Nothing here can be verified against Google by any test.** The suite drives a
mock provider; the real round trip is a human's check, and it is written down:
[`GOOGLE-CHECK.md`](GOOGLE-CHECK.md).

## Before you open a PR

The checklist `integration-guides.md` §Guide format asks of every guide. Run it
from `apps/server/`:

- [ ] The **pre-PR protocol** passes, every line, from
      `docs/standards/testing-strategy.md` §`apps/server` — including
      `govulncheck` and the compose path, which is the only thing that sees
      whether the binary starts on `scratch` at all.
- [ ] The **architecture guard** is green, and if you moved a package, its walk
      still finds everything: `go test -count=1 ./internal/`.
- [ ] **A new configuration variable** is in all four homes — `.env.example`,
      `infra/local/docker-compose.yml`, `.github/workflows/server.yml`, and the
      table above. Only the first is caught by a test.
- [ ] **A new dependency** was discussed first (root `CLAUDE.md`), and `go.mod`'s
      direct block still lists only what the discussion approved.
- [ ] **Every guard you added was seen to fail** at its own assertion, and the
      commit message names the test and the line
      (`testing-strategy.md` §Conventions (all apps)).
- [ ] Docs that the change obligated ship in the same PR
      (`docs/standards/documentation.md`).
- [ ] **If you touched the login path**, [`GOOGLE-CHECK.md`](GOOGLE-CHECK.md) was
      run against a real Google OAuth client. No test in this repository reaches
      Google, so a green suite is not evidence that signing in still works.

## References

- [`docs/decisions/0034-…`](../../docs/decisions/0034-the-backend-is-born-with-the-controls.md)
  — why the backend was pulled forward, and the one-binary/two-surface shape.
- ADR-0006 (Go) · ADR-0007 (SQLite first) · ADR-0009 (professor-only auth) ·
  [ADR-0036](../../docs/decisions/0036-the-professor-session-is-ours-and-costs-no-dependency.md)
  (the session is ours, server-side, and costs no dependency).
- [`docs/standards/guides/add-a-backend-endpoint.md`](../../docs/standards/guides/add-a-backend-endpoint.md)
  — the chain to follow when adding a route here.
- [`docs/design/2026-08-controles.md`](../../docs/design/2026-08-controles.md)
  — the subsystem this server was born to serve.
