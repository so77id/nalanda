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
| `NALANDA_LOG_LEVEL` | no (`info`) | `debug`, `info`, `warn` or `error` |
| `NALANDA_PUBLIC_URL` | yes | Base URL the server is reached at — scheme, host, optional port, and **no path**. The OAuth redirect URI is built from it and its scheme decides the cookie's `Secure` flag; a base carrying a path would build a redirect URI these routes do not serve, so it is refused at boot |
| `NALANDA_GOOGLE_CLIENT_ID` | yes | The Google OAuth client (ADR-0009) |
| `NALANDA_GOOGLE_CLIENT_SECRET` | yes | Its secret. Never printed: `config.Config` redacts it for both `fmt` and `slog` |
| `NALANDA_SESSION_TTL` | no (`720h`) | Session lifetime, as a Go duration. Zero or negative is a startup error |
| `NALANDA_BOOTSTRAP_PROFESSOR_EMAIL` | no | On a database with **no** professors, the first Google login by this address creates one. Inert as soon as any professor exists |
| `NALANDA_QUESTIONS_JSON_URL` | yes | The published question bank (ADR-0032). `http://`, `https://` or `file://`. Fetched **once at boot** and held in memory; a parse failure is a panic there. WP-E |
| `NALANDA_AMC_WORKER_URL` | yes | The AMC worker's HTTP origin, e.g. `http://amc-worker:8080` in compose. Absolute http/https URL, no path. WP-E |
| `NALANDA_WORK_DIR` | yes | Where the server sees the shared volume. The `.tex` generator emits `/work` absolute paths regardless (that is the worker's mount); this only decides where the server writes its files. WP-E |
| `NALANDA_MAX_SCAN_MB` | no (`100`) | Largest scan PDF the upload handler accepts, in whole MB. A 4-page control at 300 dpi is roughly 3–5 MB; 100 fits a large class and refuses a runaway upload before it enters the worker. WP-F |

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

# Build the production image (12.2 MB, measured 2026-08-16 on darwin/arm64:
# `docker image inspect nalanda/server:dev --format '{{.Size}}'` = 12827991).
# It was 10.3 MB before #150 added the auth domain, the OIDC client and an
# embedded template; the figure is reported, never gated — a test that reddens
# because a number moved teaches nothing (ADR-0034 §Consequences).
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
internal/app/web/  the professor's backoffice
  handler/         the login round trip and the professor CRUD
  middleware/      cookie → professor, the gate, CSRF
  oauthstate/      the single-use state nonces of the OAuth flow
  flash/           the one-shot POST/redirect/GET message cookie
  view/            html/template, embedded — shell + pages
internal/app/api/  the JSON/WS surface — anonymous, no middleware (§C12)
internal/infra/    adapters: config, storage, httpserver, httpjson, selfcheck
  oidc/            the Google client — standard library, no OIDC dependency
  storage/authstore/  the SQLite side of the auth domain
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

Routes today:

| Route | What |
|---|---|
| `GET /` | Redirects to `/controls` (an anonymous request lands in `/login` first, via the gate). Superseded #151's redirect to `/professors` when WP-E landed |
| `GET /controls` | The list, ordered by application_date desc with nulls last |
| `GET /controls/new` · `POST /controls` | Pick a section range, generate the PDF |
| `GET /controls/{id}` | Detail: metadata, PDF downloads, the Escaneos upload form, the Resultados table and (after upload) the *Cerrar corrección* button |
| `GET /controls/{id}/sujet.pdf` · `GET /controls/{id}/corrige.pdf` | Streamed from the shared volume |
| `POST /controls/{id}/scans` | Multipart PDF upload — hands the file to the worker's `/analyse`, persists the report, flips the state to `in_review` |
| `POST /controls/{id}/reanalyze` | Re-reads the stored captures at new `ticked`/`unsure` thresholds without a new capture |
| `POST /controls/{id}/close` | Moves the control to `graded` when every failure kind is resolved (WP-F S8) |
| `GET /controls/{id}/copies/{copy}/review` · `POST` | Split view — scanned image + editable form; POST saves overrides through `answer_override` / `rut_override` |
| `GET /controls/{id}/copies/{copy}/page/{n}` | Streams the scanned page image from the shared volume |
| `GET /professors` | The list: address, name, state, created, last sign-in |
| `GET /professors/new` · `POST /professors` | Create by address and name — the `Authenticate` path (2) round trip |
| `GET /professors/{id}/edit` · `POST /professors/{id}` | Rename. The address is not editable |
| `POST /professors/{id}/deactivate` | Flips `is_active=0` and ends every session that professor holds |
| `POST /professors/{id}/reactivate` | Flips `is_active=1` and clears `deactivated_at` |
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
| Courses, students, enrolment — any domain table | WP-D |
| JSON contracts, CORS, WebSocket on `/api` | with a consumer (ADR-0008) |
| A per-control upload quota (batches per control, or total bytes) — today `NALANDA_MAX_SCAN_MB` bounds ONE upload | when an operator wants a ceiling on abuse by an authenticated professor |
| Publishing grades (CSV export, Canvas, email) | WP-G |
| Bulk download of annotated PDFs as a ZIP | when the pile is large enough — captured in #167 §Notes |
| Regenerating the annotated PDF after a manual override | #167 §Non-goals; the annotated stays a view of what AMC read, overrides live in the DB |
| Roster / student names, isolation between professors | V2 / #163 |
| Deploy, hosting, secrets | deferred (`2026-08-controles.md` §C15) |
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
