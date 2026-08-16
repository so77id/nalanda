# apps/server — the Nalanda backend

One Go binary serving **two delivery surfaces** over one shared domain: the
professor's server-rendered backoffice and a JSON/WebSocket API for anonymous
students (ADR-0034). SQLite is its database, embedded migrations are applied at
boot, and the production image is a static binary on `scratch`.

Today it starts, reaches its database, and answers `/health`. That is all — see
[What is not here yet](#what-is-not-here-yet).

## Stack

| | |
|---|---|
| Language | Go — the version lives in [`go.mod`](go.mod) and is stated nowhere else, this table included (`backend-code-style.md` §Version) |
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
| `NALANDA_PUBLIC_URL` | yes | Base URL the server is reached at. The OAuth redirect URI is built from it, and its scheme decides the session cookie's `Secure` flag |
| `NALANDA_GOOGLE_CLIENT_ID` | yes | The Google OAuth client (ADR-0009) |
| `NALANDA_GOOGLE_CLIENT_SECRET` | yes | Its secret. Never printed: `config.Config` redacts it for both `fmt` and `slog` |
| `NALANDA_SESSION_TTL` | no (`720h`) | Session lifetime, as a Go duration. Zero or negative is a startup error |
| `NALANDA_BOOTSTRAP_PROFESSOR_EMAIL` | no | On a database with **no** professors, the first Google login by this address creates one. Inert as soon as any professor exists |

## Commands

Run from `apps/server/`.

```bash
# Run it, against a database in this directory (gitignored).
NALANDA_ADDR=127.0.0.1:8081 NALANDA_DATABASE_URL=./nalanda.db go run ./cmd/server

curl -s http://127.0.0.1:8081/health      # backoffice surface
curl -s http://127.0.0.1:8081/api/health  # API surface

# Verify. The two protocols are defined in docs/standards/testing-strategy.md;
# this is the per-commit one. Note the `test -z`: `gofmt -l` PRINTS the files it
# objects to and exits 0 either way, so a bare `gofmt -l . && …` chain reads
# like a gate and is not one.
test -z "$(gofmt -l .)" && go vet ./... && go build ./... && go test ./...

# Build the production image (10.3 MB, measured 2026-08-16).
docker build -t nalanda/server:dev .
```

### With Docker

Local orchestration lives in `infra/local/`, not here — it coordinates services
and belongs to none of them (`repository-structure.md` §Placement criteria). The
app still packages itself: the `Dockerfile` is in this directory.

```bash
cd ../../infra/local

docker compose up -d --wait server        # --wait means "the database answers"
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
internal/app/web/  the professor's backoffice
internal/app/api/  the JSON/WS surface
internal/infra/    adapters: config, storage, httpserver, httpjson, selfcheck
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

## What is not here yet

Deliberately, and each with an owner:

| Missing | Arrives with |
|---|---|
| Authentication, sessions, OAuth, users | WP-C2 — [#150](https://github.com/so77id/nalanda/issues/150) |
| The backoffice UI, templates, professor CRUD | WP-C3 — [#151](https://github.com/so77id/nalanda/issues/151) |
| Courses, students, enrolment — any domain table | WP-D |
| JSON contracts, CORS, WebSocket on `/api` | with a consumer (ADR-0008) |
| Talking to `apps/amc-worker` | WP-E |
| Deploy, hosting, secrets | deferred (`2026-08-controles.md` §C15) |

`migrations/00001_init.sql` is empty on purpose and says so at length: the WP
creates no domain tables, and the file exists because `//go:embed *.sql` needs
one and because it makes the migration path provable. **WP-C2 deletes it** in
the same PR that adds the first real migration; the non-vacuity guard in
`internal/infra/storage/sqlite_test.go` keeps the path proven either way.

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

## References

- [`docs/decisions/0034-…`](../../docs/decisions/0034-the-backend-is-born-with-the-controls.md)
  — why the backend was pulled forward, and the one-binary/two-surface shape.
- ADR-0006 (Go) · ADR-0007 (SQLite first) · ADR-0009 (professor-only auth).
- [`docs/design/2026-08-controles.md`](../../docs/design/2026-08-controles.md)
  — the subsystem this server was born to serve.
