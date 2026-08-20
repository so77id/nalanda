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
  internal/infra/    adapters: config, storage (+ authstore), httpserver,
                     httpjson, selfcheck, oidc
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
- **A typed error wrapping a sentinel** when a branched failure must also
  carry structured fields for a renderer to read. Implement `Unwrap() error`
  returning the sentinel so `errors.Is` on the sentinel keeps matching, and
  give the type exported fields the renderer needs — status code, message,
  detail — so nobody has to regex the error string back out. Worked case
  (#210): `controls.AnalyzerRefusedError{Status, Message, Detail}` unwraps
  to `ErrAnalyzerRefused`; the handler's `refusedFlash` reads Detail via
  `errors.As` to embed the worker's first stderr line in the flash a
  professor sees, and `Error()` composes Status + Message so
  `slog.Warn(err)` still reads `worker answered NNN: msg` the way pre-#210
  log parsers expect. Reach for this shape when a `fmt.Errorf` with a
  formatted status prefix would force every renderer to re-parse it.
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
- **Render a template into a BUFFER before writing the header**
  (`view.RenderLogin`, and every render function added beside it).
  The template half of the `httpjson.Write` rule above, and for the same reason:
  executing straight into the `ResponseWriter` commits a 200 with the first byte,
  so a template that fails halfway arrives as a successful truncated page.
- **Templates are parsed once, at package initialisation, and a parse error is a
  panic at boot.** That is the deliberate exception to §Errors: a typo becomes a
  failure an operator sees immediately instead of a 500 on the one page nobody
  visits.
- **Every page sets the same security headers** (`view.setSecurityHeaders`):
  `no-store`, `nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
  `Referrer-Policy: same-origin`. A page carrying a session's CSRF token must not
  be cacheable or framable, and the development public URL is http.
- **The session cookie's attributes are not choices.** `HttpOnly`, `SameSite=Lax`
  and `Path=/` always; `Secure` is DERIVED from `NALANDA_PUBLIC_URL`'s scheme
  (`config.SecureCookie`), never set by hand — the two can only disagree in the
  direction that either breaks local login or ships a token in clear.
- **The session and OAuth-state cookie NAMES are also derived, not literal.**
  Since #162, `middleware.SessionCookieName(secure)` and
  `handler.StateCookieName(secure)` are functions of the `Secure` flag: they
  return `__Host-nalanda_session` / `__Host-nalanda_oauth_state` when
  `Secure` is true (production, https), and the unprefixed names when it is
  false (local dev, http). Every read AND write goes through those helpers.
  Two literal-string tests
  (`TestSessionCookieNameCarriesHostPrefixInProductionAndNotInDev` and
  `TestStateCookieNameCarriesHostPrefixInProductionAndNotInDev`) pin the
  four strings against the HELPERS, so a caller that bypasses the helpers
  and writes the bare literal reads no cookie in production and the login
  breaks on the deployed URL — the exact "difference that only shows up in
  production" #150 originally rejected the prefix over, now closed at the
  seam. Review triggers: `docs/security-notes.md` §"The login's state cookie
  is a double-submit cookie" and §"The session cookie has no `Secure` flag
  in development".
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

## Forms, flash and error pages

The backoffice's server-rendered shape, born in WP-C3 (#151). These rules
apply to every screen `internal/app/web` grows from here on — WP-D's roster
import, WP-E's control creation, WP-F's review queue.

### Every page renders through the shell

`internal/app/web/view` parses `templates/layout.html` once at package init
and stitches every page under `templates/pages/*.html` onto a clone of it.
The layout carries the two-half navigation, both themes (`color-scheme:
light dark`, `currentColor` only), the embedded CSS, and the render of
`.Flash`. `view.render` is the only writer: it buffers into memory, sets
the security headers and the content type, writes the status, and only
then writes the body — a template that fails halfway must not arrive as a
200 with a truncated page.

**Add a page**: an HTML file under `templates/pages/`, a `Page`-embedding
struct in `view.go`, and a `RenderXxx` that delegates to `render` with a
status parameter. The status is a parameter because the same page (see
below) renders both 200 and 422; a fresh render function that hard-coded
200 would ship a validation refusal as success.

**The handler fills the shell fields (title, professor, csrf) with
`middleware.PageFor(r, title)` and writes shell error pages with
`middleware.WriteError(w, r, status, message)`** — one helper each, so a
new page cannot silently drift from the shell every other page shows. The
same block used to be inlined in four callers before the WP-C3 review
extracted them (ARQ-1, ARQ-2).

### Form / validation / errors

One shape for every write screen (`ProfessorsFormPage` is the worked case):

- **The SAME template handles GET (empty), validation-failure re-render
  (values + errors) and edit (pre-filled)**. `EmailReadonly` and per-page
  `Action`/`Heading`/`Submit` are what differ.
- **Errors are field-keyed** (`map[string]string`). A single blob would
  make a two-error submission read as "something went wrong".
- **A form-wide failure that belongs to no field goes into a dedicated
  `Notice` string on the page struct**, rendered above the fields. Do NOT
  reach for `Errors[""]` — an empty-string key is silently dropped by the
  template (COR-1, WP-C3 review), so the message never reaches the
  professor. Worked case: `view.ProfessorsFormPage.Notice` carries
  "No se pudo leer el formulario" when `r.ParseForm()` fails.
- **The values the professor typed come back on refusal**. A form that
  lost the input would tempt a fix that hits a different validation
  branch by accident and turns a rejection into a confusing loop.
- **A refusal is 422**, never 200. A refusal rendered as 200 would look
  right in a browser and hide the rejection from anything reading the HTTP
  layer.
- **Known-shape domain errors become field errors, not 500s**. Duplicate
  email is the worked case — `authstore.CreateUser` surfaces the SQLite
  UNIQUE violation as text, `isDuplicateEmail` matches it, the field gets
  a Spanish message. A preflight SELECT would be a race window and is not
  the pattern.
- **Every state-changing form carries `<input type="hidden"
  name="csrf_token" value="{{ .CSRFToken }}">`** — the router's guard
  refuses a POST without it and `TestEveryStateChangingRouteVerifiesCSRF`
  walks the table to prove it.

### Flash — POST/redirect/GET

Server-side "your action worked" between a mutation and the redirected GET
that shows it. `internal/app/web/flash.Set` writes a base64-encoded
HttpOnly cookie; `flash.Consume` reads it AND clears it in the same
response, so a refresh does not re-show "Profesora creada" and tell the
professor they created two.

**Do NOT use a query parameter** (`?aviso=`) for a mutation's message —
it lands in URL bar, history, page title and proxy access logs, and
re-shows on reload. `?aviso=` stays on the login page because that route
is public and has no session to hang a flash on.

**Guard refusals reach the professor as flash + redirect (303), not as a
4xx** (issue #151 AC-8). The domain returns a sentinel error, the handler
branches on it with `errors.Is`, sets the Spanish message and redirects to
the list. `auth.ErrCannotDeactivateSelf` and
`auth.ErrCannotDeactivateLastActive` are the worked cases.

### Error pages — 404 / 403 / 500

`view.RenderError` writes any of them through the shell with the caller's
status. `middleware.WriteError(w, r, status, message)` is its only
production caller: it builds the `view.ErrorPage` from the request context
via `middleware.PageFor` and falls back to `http.Error` if the render
itself fails. Three sites reach the helper today:

- `router.renderNotFound` — the surface's default 404, distinguished from a
  405 by looking up the request path in the routes table (a wrong verb
  reaches the mux so its Allow header is set).
- `middleware.renderForbidden` — the state-changing gate's refusal (no
  session on a state-changing request, unparseable body, or wrong CSRF
  token), replacing the plain-text `http.Error`.
- Handler-side inline calls, `middleware.WriteError(w, r,
  http.StatusInternalServerError, "…")` — the last-resort catch when the
  domain fails a read. `professors.go` has six such sites.

An error page reached by a signed-in professor still shows the bar, so
they can leave the 404 by clicking Profesores rather than the back button.

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
5. **Never reuse a version number, even a deleted one.** #150 deleted #149's
   placeholder `00001_init.sql` and numbered the auth schema `00002`, which
   looks like a gap and is not one: goose records the VERSION it applied, so a
   new `00001` counts as already applied on every database that ran the
   placeholder, and its tables would never be created. The failure is silent at
   boot and appears later as "no such table". The guard is
   `TestTheAuthMigrationAppliesOverADatabaseThatRanThePlaceholder`, which is the
   only case that starts from a database rather than from an empty file.
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
  A `const` or `var` block may share one group comment INSTEAD of per-identifier
  ones when the members are variations of a single idea (`config.KeyAddr` and
  its siblings); a block whose members mean different things does not qualify.
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
- **When two layers can produce the same answer, assert on what only one of them
  produces.** A status code is usually not it: in #150, `POST /logout` with no
  session answers 303 from the gate AND 303 from the handler that runs when the
  gate is absent, so two tests asserting the status stayed green with the gate
  removed. They now assert the redirect DESTINATION. Reach for the Location
  header, the body, or a side effect in the database.
- **When mutation shows a test proves less than its name, rename the test and
  move the rule to the layer that can express it**, leaving the reason in a
  comment. #150's `TestTheBootstrapDoesNotAdmitASecondStranger` survived the
  removal of the check it was named for, because its second account was refused
  earlier by an unrelated comparison; the narrow rule moved to the domain, where
  the case can be set up, and the handler test took the name of what it proves.
- **A guard that shells out to a subprocess is invisible to the build cache.** A
  test package that imports nothing from the module is considered unchanged
  whatever happens to the code, so `go test ./...` replays a cached PASS. Read
  files with the standard library instead; the cache tracks those.
- **A refusal test asserts BOTH the sentinel AND the state the guard is
  protecting.** A test that names one guard but only checks the error a
  handler returns is falsifiable by a mutation that swaps sentinels — the
  case still trips one, and the state the guard was supposed to prevent goes
  unchecked. Worked case: `TestDeactivateRefusesSelf` in
  `internal/domain/auth/admin_test.go` asserts `errors.Is(err,
  ErrCannotDeactivateSelf)` AND re-reads the row via `UserByID` to prove
  `IsActive` is still true and `DeactivatedAt` is still nil. The re-read is
  what catches a mutation that renamed the branch: without it, a code path
  that returns the right error but ALSO flipped the flag ships green.
  Learned in the WP-C3 review (COR-7).

## References

- ADR-0005 — development standards (bounded style, guides, docs-in-flow).
- ADR-0006 — the backend is Go · ADR-0007 — SQLite first · ADR-0034 — the
  backend is born with the controls (the layered layout and its rationale).
- `repository-structure.md` — the rule that a new language brings its standards
  document with the app that introduces it.
- `testing-strategy.md` §`apps/server` — the two protocols.
