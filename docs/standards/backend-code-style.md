# Backend Code Style — `apps/server`

Bounded style for the Go in this monorepo. Same contract as its siblings
(`frontend-code-style.md`, `python-code-style.md`): agents follow it, they do not
innovate on it. Born with `apps/server` (#149), which is the only Go here today.

Go is the language for **application logic on the server** (ADR-0006):
authentication, the professor's backoffice, the controls domain, and the future
session relay. It is not the language for course content (that is MDX under
`content/`), for the browser (TypeScript in `apps/web`, ADR-0004), or for
driving a third-party CLI (Python in `apps/amc-worker`).

Everything the standard library already decides — brace placement, tabs,
receiver spacing — is decided by `gofmt` and is not repeated here. This document
covers only what `gofmt` and `go vet` cannot.

## Version and dependencies

- **Go as declared in `apps/server/go.mod`**, currently 1.25.13. CI reads the
  version from that file (`go-version-file`), so the toolchain a job uses and
  the one the module declares cannot drift. **Keep it at or above the patch the
  Dockerfile's pinned builder ships**: the two were 1.25.7 and 1.25.13 for one
  WP, so CI tested on a toolchain older than the one that built the image, and
  the gap contained GO-2026-6089 — a `net/http` fix to how `ReadHeaderTimeout`
  is applied, i.e. the very defence this server relies on (#149 review).
- **Dependencies are a PR discussion**, like every manifest in this repo (root
  `CLAUDE.md`). The direct set is deliberately tiny and an addition needs a
  reason recorded in the issue that adds it:

  | Dependency | Why |
  |---|---|
  | `modernc.org/sqlite` | Pure-Go SQLite. No CGO is what makes the production image a static binary on `scratch` (ADR-0007). |
  | `github.com/pressly/goose/v3` | Migrations as SQL files, embedded in the binary, applied at boot. |

- **No router dependency.** `net/http.ServeMux` has method-and-pattern routing
  since Go 1.22, and putting the method in the pattern is what makes a wrong
  verb a 405 instead of a 404. The archived POC's chi (#28, Postgres era) is not
  carried over.
- **No test framework.** `testing` and `net/http/httptest`. Table-driven cases
  and helpers cover what an assertion library would, without a vocabulary every
  reader has to learn first.
- **No logging library.** `log/slog`, structured, to stderr.

## Layout

The layered layout of ADR-0034 (§C11). Each directory is created by the slice
that gives it content — `repository-structure.md` §Principles forbids creating
the tree empty and filling it later.

```
apps/server/
  cmd/server/        wiring and entry point — the only main package
  internal/domain/   business types and the interfaces they need — PURE
  internal/app/web/  the professor's backoffice (server-rendered)
  internal/app/api/  the JSON/WS surface for anonymous students
  internal/infra/    adapters: config, storage, httpserver, httpjson, selfcheck
  migrations/        goose SQL migrations, embedded
```

### The dependency rule

Three edges, all enforced:

1. **`internal/domain` imports neither `internal/app` nor `internal/infra`, and
   no third-party package at all.**
2. **`internal/infra` does not import `internal/app`.** Infra holds adapters and
   sits beneath the surfaces, not beside them. If an adapter genuinely needs a
   value a surface owns, it is passed in from `cmd/server`.
3. **Neither delivery surface imports the other.** They are siblings; what they
   share lives in the domain, or in `internal/infra` when it is transport
   machinery.

Edge 2 was missing from both this document and the guard for the length of one
WP, and `internal/infra/storage` could import `internal/app/web` in full green
(#149 review). It is written down here because a rule a test enforces and no
document states is a rule the next reader will treat as an accident.

This is not advice. `internal/architecture_test.go` walks the package graph and
fails on a violation, including a transitive one. It is the rule DocumentBuddy's
ADR-005 records as violated in 13 files, which is why #149 chose to correct on
entry rather than port the debt.

**When the domain needs something from outside, it declares the interface and
infra implements it.** The worked example is `health.Prober`: declared in
`internal/domain/health`, implemented by `storage.Prober`. The arrow points
inwards, always.

```go
// internal/domain/health — the domain says what it needs.
type Prober interface {
    Probe(ctx context.Context) error
}

// internal/infra/storage — infra satisfies it, and pins that with a
// compile-time assertion in its test.
var _ health.Prober = (*storage.Prober)(nil)
```

**Interfaces are declared where they are CONSUMED, not where they are
implemented.** A package that exports an interface alongside its only
implementation has written a Java class in Go; the consumer's needs are what
should shape the method set.

## Errors

- **Wrap with `%w` and context that names the subject.** `fmt.Errorf("reach the
  database at %s: %w", path, err)`, never a bare `return err` at a boundary
  worth naming. The reader of a log line has only what the message carries.
- **Sentinel errors for conditions a caller branches on**, compared with
  `errors.Is`. Worked case: `config.ErrMissing` distinguishes "the operator has
  not finished configuring this" from "the operator configured it wrongly".
- **Never `panic` in a request path.** A handler that cannot proceed writes a
  status; `panic` is for a programming error at wiring time and nothing else.
- **Never discard an error silently.** `_ = f.Close()` in a `defer` is fine and
  says the discard is deliberate; an ignored return from something that can
  really fail is not.

## Configuration

Environment variables only, read **once at boot** into a struct, through
`internal/infra/config`. Nothing below that package reads the environment.

- **A required variable that is absent OR EMPTY is a startup error naming it.**
  A zero value silently taken as a default is how a server starts with an empty
  database path and fails somewhere else, later, about something unrelated.
- **Report every missing variable in one run.** An operator starting from an
  empty environment should need one run to learn what to set.
- **A default is allowed only where there is an obviously right value and no way
  for a wrong one to pass unnoticed**, and the value is still validated against
  a listed set. `NALANDA_LOG_LEVEL` is the one example.
- **`.env.example` is part of the contract**, committed, and checked by a test
  against `config.Keys()` — a variable added to the struct and forgotten in the
  example turns the suite red. `.env` is never committed.

## HTTP

- **The method belongs in the ServeMux pattern** (`"GET /health"`). That is what
  produces a 405 rather than a 404 for the right path with the wrong verb.
- **A handler is a closure over its dependencies**, returned by a small
  constructor. No package-level state, no service locator.
- **Status codes are derived from a domain value, never assigned alongside it.**
  An endpoint that answers 200 with a body saying "down" is read as healthy by
  every orchestrator that has ever existed.
- **Encode a response body BEFORE writing the header** (`httpjson.Write`).
  Encoding into the `ResponseWriter` commits the status line first, so a value
  that fails to marshal arrives as a 200 with a truncated body.
- **Every server-side timeout is set explicitly — all five.** `ReadTimeout`,
  `ReadHeaderTimeout`, `WriteTimeout`, `IdleTimeout` and `MaxHeaderBytes`. Each
  defaults to zero and zero means *no limit*, so what they prevent is a slow
  leak rather than a visible failure. Measured: with only `ReadHeaderTimeout`
  set, 50 idle keep-alive sockets against the real container were all still
  usable after 45 seconds, because that setting bounds the header read once
  bytes arrive and says nothing about the wait BETWEEN requests (#149 review).
  This document previously said "`ReadHeaderTimeout` at minimum", and the code
  that satisfied it was the code being measured.
  **`WriteTimeout` has a known expiry**: ADR-0008 puts a WebSocket relay on the
  api surface, and a global write deadline kills a long-lived connection. It
  moves onto the routes that want it when that arrives — it is not deleted.

## Database

- **Only `internal/infra/storage` names a driver.** Everything above receives a
  `*sql.DB` or a repository interface, which is what keeps the Postgres swap of
  ADR-0007 a localized change.
- **Opening a database includes a round trip.** `database/sql` connects lazily,
  so `sql.Open` alone returns a healthy-looking handle for a path nothing can
  ever write.
- **Pragmas go in the DSN and are asserted by a test that asks the open
  connection what it has.** They are per-connection and default to off;
  an unenforced foreign key fails silently, by keeping rows it should have
  rejected.
- **Every query takes a `context.Context`** — `QueryRowContext`, `ExecContext`,
  never the context-free variants.
- **Migrations are embedded and applied at boot**, so the binary and the schema
  it expects ship together.

### Adding a migration

The extension point born with this app. Registered in `integration-guides.md`.

1. **One file per change, in `apps/server/migrations/`**, named
   `NNNNN_snake_case.sql` with a zero-padded sequential number. `//go:embed
   *.sql` takes the package ROOT only — a file in a subdirectory compiles and
   silently does not ship.
2. **Both directions.** `-- +goose Up` and `-- +goose Down`. The Down block is
   never executed by anything (see ADR-0034 §Consequences: rolling back over an
   applied migration is not supported), so write it as documentation of the
   inverse rather than as a tested path.
3. **`-- +goose StatementBegin`/`StatementEnd` around anything containing a
   semicolon that is not a statement separator** — a trigger body, a function.
   goose splits on semicolons otherwise and hands SQLite half a statement.
4. **Never edit a migration that has been applied anywhere.** goose records the
   version, not the content, so an edit is invisible to a database that already
   ran it.
5. **The first real migration deletes `00001_init.sql`** in the same PR. That
   file exists only so `//go:embed` has something to take and so the boot path
   is provable; it is a `SELECT 1;` and does not belong in permanent schema
   history.
6. Run the pre-PR protocol: `sqlite_test.go` applies the embedded set to a fresh
   temp file and asserts a second boot applies nothing.

## Naming

- Package names are short, lower-case, single words, and never `util`, `common`
  or `helpers` — a package named for what it contains rather than what it does
  attracts everything.
- **The package name is part of every identifier it exports.** `health.Check`,
  not `health.CheckHealth`; `storage.Open`, not `storage.OpenDatabase`.
- Receivers are one or two letters, consistent across a type's methods.
- Exported identifiers carry a doc comment starting with the identifier's name.
- English identifiers, like everywhere else. Spanish appears only in strings a
  person reads — and on this surface that means the backoffice's rendered text,
  which is course-facing UI (root `CLAUDE.md`).

## Comments

The repo's documentation culture applies here unchanged, and it is the part most
worth reading before writing Go in this repo:

- **A package comment says what the package is for and what it costs**, not what
  its name already says.
- **Comment what was measured or decided, not what is obvious.** `// increment
  the counter` is noise; `// CGO_ENABLED=0 is load-bearing: with it on the
  binary links against musl and cannot start on scratch` is the reason the line
  is there.
- **When a comment claims a fact the suite does not verify, it says so.** Worked
  case: `storage.Prober` explains why it runs a `SELECT` rather than `Ping`, and
  states plainly that swapping the two leaves every test green and why the
  distinguishing case is unreachable from a test. A comment that promises a
  guarantee the tests do not hold is worse than no comment.

## Testing

Both protocols are registered in `testing-strategy.md` §`apps/server`. The rules
for writing a test here:

- **Tests are colocated** and use an **external test package** (`package
  foo_test`), so a case can only reach what a real caller can. Reaching into
  unexported state is how a test starts asserting the implementation.
- **Table-driven cases** over a full fixture that each case breaks in exactly
  one way — a case can never pass because a second thing was also wrong.
- **A non-vacuity guard for anything that iterates a discovered set.** A loop
  over an empty collection is a green test that verifies nothing. Worked case:
  the architecture test's walk found nothing at all for one revision, and only
  its non-vacuity assertions caught it (#149 S5).
- **Nothing is done before its test has been seen to fail, at the assertion that
  encodes it.** Break the code, run the suite, name the failing test and line in
  the commit message, restore. Reviewing a test by reading it is how a test that
  cannot fail gets written — three such tests were written and caught this way
  in #149 alone.
- **A guard that shells out to a subprocess is invisible to the build cache.** A
  test package that imports nothing from the module is considered unchanged
  whatever happens to the code, so `go test ./...` replays a cached PASS. Read
  files with the standard library instead; the cache tracks those.

## References

- ADR-0005 — development standards (bounded style, guides, docs-in-flow).
- ADR-0006 — the backend is Go · ADR-0007 — SQLite first · ADR-0034 — the
  backend is born with the controls (the layered layout and its rationale).
- `repository-structure.md` — the rule that a new language brings its standards
  document with the app that introduces it.
- `testing-strategy.md` §`apps/server` — the two protocols.
