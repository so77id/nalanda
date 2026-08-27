# Add a backend endpoint

The extension point `apps/server` exists to be extended through: one HTTP route,
the domain behind it, the repository under that, and the tests that hold all
three honest.

Deferred from #149 on purpose — a guide written against a worked example that
does not exist is fiction — and written by #150, which produced the first real
chain: a route, a domain service, three repositories and a migration. Since
WP-E (#166) there is a second, non-auth chain that adds the pieces this guide
did not exhibit — a domain interface for an outbound HTTP adapter
(`controls.Generator`, implemented by `amcworker.Client`, with the fake living
next to the client in `amcworker/amctest`), a domain service that orchestrates
a store and that adapter together (`controls.Service`), and a handler that
maps a family of domain sentinels onto per-field form errors while letting
operator-caused failures render a shell 500 (`handler/controls.go`
`domainErrorToForm`). Reach for that chain when the endpoint reaches out over
HTTP as well as into SQLite; the auth chain is still the smaller shape.

## When to use

Adding any route to `apps/server`, on either surface. Read `Adding a migration`
([`backend-code-style.md` §Adding a migration](../backend-code-style.md#adding-a-migration))
first when the endpoint needs a table it does not have.

**Decide which surface it belongs to before anything else** (ADR-0034, §C11):

| | `internal/app/web` | `internal/app/api` |
|---|---|---|
| Reader | the professor, in a browser | `apps/web`, on a student's machine |
| Renders | server-side `html/template` | JSON, and WebSocket later (ADR-0008) |
| Auth | a session, via the middleware | none — anonymous, room codes (§C12) |
| Errors | a page, in Spanish | a JSON body |

The two never import each other, and `internal/architecture_test.go` fails the
build if they do. What they share goes in `internal/domain`, or in
`internal/infra` when it is transport machinery.

## Worked example

`POST /logout` (#150), which is the smallest complete chain in the tree: a gated,
state-changing route that reaches the domain, which reaches a repository, which
reaches a table.

```
apps/server/
  migrations/00002_auth.sql                        the table
  internal/domain/auth/auth.go                     the type + the store INTERFACE
  internal/domain/auth/login.go                    the behaviour (EndSession)
  internal/infra/storage/authstore/authstore.go    the SQLite implementation
  internal/app/web/handler/auth.go                 the handler (Auth.Logout)
  internal/app/web/router.go                       the route + its middleware
  cmd/server/main.go                               the wiring, once, in order
```

Read it in that order. The arrow points inwards the whole way: the handler knows
the domain, the domain knows an interface, and only `authstore` knows SQLite.

## Step-by-step

### 1. The migration, if the endpoint needs a table

`backend-code-style.md` §Adding a migration. One file, both directions, never
edit an applied one.

### 2. The domain type and the interface it needs

In `internal/domain/<area>/`. **Pure**: no `internal/app`, no `internal/infra`,
no third-party import — all three enforced by `internal/architecture_test.go`,
transitively.

Declare the persistence you need as an interface **here**, where it is consumed,
not next to the implementation (`backend-code-style.md` §The dependency rule):

```go
// internal/domain/auth/auth.go
type SessionStore interface {
    DeleteSession(ctx context.Context, hash string) error
}
```

Absence gets a sentinel — `auth.ErrNotFound` — so a caller can tell "no such row"
from "the database is unreachable" without importing `database/sql`. That
distinction is load-bearing: #150's middleware logs a professor out on the first
and deliberately does not on the second.

Time is a parameter, or a `func() time.Time` field. There is no clock package,
and there is not going to be one: it would be a domain-to-infra import.

### 3. The behaviour

Still in the domain, as a small service over those interfaces — `auth.Login` is
the worked case. This is what keeps handlers thin and what makes the interfaces
have a domain-side consumer at all.

### 4. The repository

In `internal/infra/storage/<area>store/`, taking a `*sql.DB`. Only
`internal/infra/storage` may name a driver
(`TestOnlyTheStoragePackageNamesADatabaseDriver`), which is what keeps ADR-0007's
Postgres exit a change in one package.

- Every query takes a `context.Context`.
- Map `sql.ErrNoRows` onto the domain's sentinel at this boundary, and wrap
  everything else.
- Pin the interface at compile time, the way `storage.Prober` does:
  `var _ auth.SessionStore = (*Store)(nil)`.

**On `web`, this WP's screens follow one shape** — form, validation, flash
messages, and error pages. All of it is written down in
[`backend-code-style.md` §Forms, flash and error pages](../backend-code-style.md#forms-flash-and-error-pages);
read it before adding a screen so a new one does not invent a convention.
Fill the shell fields (title, professor, csrf) with
`middleware.PageFor(r, title)` and write shell error pages via
`middleware.WriteError(w, r, status, message)` — the same helpers §Add a
page names, so a new caller does not re-inline the block the review
consolidated (ARQ-1 / ARQ-2). §Form / validation / errors is the
create/edit form shape (with `Notice` for form-wide messages), §Flash
covers the POST/redirect/GET message cookie, §Error pages covers 404 /
403 / 500.

### 5. The handler

A closure over its dependencies, **returned by a small constructor**
(`backend-code-style.md` §HTTP). No package-level state.

Where several handlers share the same dependencies, the shape in this app is a
struct of them with the handlers as methods — but the constructor is not
optional and is the half that matters: `handler.NewAuth` refuses a set of
dependencies it cannot serve with, so a forgotten field is a panic in
`cmd/server` before the listener opens rather than a nil dereference inside a
request, which §Errors forbids.

- The method goes **in the pattern**: `"POST /logout"`, so a wrong verb is a 405
  rather than a 404.
- On `web`: render with `view`, which buffers before writing — a template that
  fails halfway must not arrive as a 200 with half a page. **Every render
  function in `view` calls `setSecurityHeaders` as its first write**; the guard
  covers the login page only, so a new one that forgets ships headerless. Text a
  person reads is **Spanish**; identifiers stay English (root `CLAUDE.md`).
- A gated handler reads its caller from the context `Resolve` filled:
  `professor, ok := middleware.ProfessorFrom(r.Context())` and
  `session, ok := middleware.SessionFrom(r.Context())`. Any form it renders
  carries `<input type="hidden" name="csrf_token" value="{{ .CSRFToken }}">` —
  the literal field name is `middleware.CSRFFieldName`, and the value is
  `session.CSRFToken`. Get either wrong and the request is a 403 whose message
  names nothing. Worked case: `templates/login.html` + `handler.Auth.LoginPage`.
- On `api`: `httpjson.Write`, which encodes before writing the header for the
  same reason.
- Never `panic` in a request path.

### 6. The route and its middleware

In the surface's `router.go`. On `web`, `Resolve` already wraps everything; the
decision you are making is what else the route needs:

```go
// internal/app/web/router.go — add an entry; the mux is built from this table.
{
    Method: http.MethodGet, Path: "/professors",
    Handler: deps.Professors.List,
    // no Public: it needs a professor, and the guard proves it does
},
{
    Method: http.MethodPost, Path: "/professors",
    Handler: deps.Professors.Create,
    // a professor AND a CSRF token, both applied by the table
},
```

**Two independent questions, and the method answers only one of them.**

1. *Does this route show or touch professor data?* Then it needs a professor —
   **whatever its method**. Every backoffice route does, except `/login*` and
   `/health`, which say why in their table entry.
2. *Does it change state?* Then it ALSO needs CSRF. The safe methods are exempt
   from that one, and a state-changing endpoint reachable by `GET` is one any
   image tag on any page can trigger.

Getting this wrong in the direction "a GET needs neither" is how a list of
professors' addresses ends up served to anonymous visitors — which is what an
earlier draft of this very guide told the next WP to do (#150 review, AGR-1).
Both axes are now enforced: the routes are a table, `Public` has to be stated
with a reason, and `TestEveryRouteIsGatedUnlessItSaysWhyNot` and
`TestEveryStateChangingRouteVerifiesCSRF` walk the same table the mux is built
from.

**Never mount either on `internal/app/api`.** That surface is anonymous by
construction (§C12), and `cmd/server/main_test.go` asserts it.

### 7. The wiring

`cmd/server/main.go`, and nowhere else. Each layer is constructed once, in order,
and handed to the next.

A new **configuration variable** lands in FOUR places, and all four are gated:
`.env.example`, `infra/local/docker-compose.yml`, `.github/workflows/server.yml`,
and the table in `apps/server/README.md`. The guard matches text rather than
parsing, so the two files an operator EXECUTES must declare the key on a
non-comment line.

### 8. The tests

Test-first, per `testing-strategy.md`. For one endpoint that usually means:

| Level | Where | What |
|---|---|---|
| L2 | beside the domain | the behaviour, in isolation |
| L6 | beside the repository | the queries, against a real temp SQLite file |
| L6 | beside the handler | the route through `httptest`, with the middleware it runs behind |
| L4 | `internal/architecture_test.go` | already covers you — it just has to stay green |

Colocated, external test package (`package foo_test`), table-driven from one
valid fixture that each case breaks in exactly one way.

**Then break the code and watch the test fail**, at the assertion that encodes
the rule, and name the test and line in the commit message. Reviewing a test by
reading it is how a test that cannot fail gets written — #150 found four of its
own that way, including two that asserted a redirect the handler produced anyway.

## A pattern the review flow adds — the split-view page

WP-F (#167) introduced a shape worth naming for the next endpoint that
carries editable per-row detail: a **review page**. The reader is the
professor sitting in front of one row's worth of context (the scanned
image on the left, the editable form on the right); the endpoint is
therefore **two URLs**, not one:

- `GET .../review` — renders the page. Loads the whole row (with any
  prior overrides eagerly attached — the store's shape is
  `SELECT … LEFT JOIN override`, so the "was this edited by a human"
  bit travels with the row) and hands the template pre-filled inputs.
- `POST .../review` — saves. The handler **enumerates the row's own
  fields** rather than trusting the client with the field set: a stale
  form that names a field the row no longer has silently drops that
  field. Values that MATCH what the machine read for that field **clear
  any override** rather than upserting a redundant one — so a professor
  can undo their own edit by putting the value back.

Where the "undo" bit lives in the schema is why the WP-F migration
holds `answer_override` alongside `answer` (both keyed by
`(reading_id, question_ref)`) rather than mutating `answer` in place:
an INSERT is what a save is, the pre-override state is what the
base row still holds, and a future audit — or "what did I change on
this student's sheet" — reads both from the same query.

The paired resource for the image on the left is a **sibling
endpoint**, not a data URL in the page: `GET .../page/{n}` streams
the scanned image (`Content-Type` set explicitly rather than sniffed
from the body). Bound the path segments with caller-side checks
(page in an absolute cap, copy within the create-form's ceiling)
before touching the disk — a per-row check that copy belongs to
this control is preferable when the row is already loaded; the fixed
cap is the fallback when it isn't.

## A pattern the archive/purge flow adds — the destructive-confirm pair

WP-#261 (ADR-0052) introduced a shape worth naming for the next
irreversible endpoint: a **destructive-confirm pair**. The precondition
is "the row is in a state that already declares intent to remove"
(here: `deleted_at IS NOT NULL`); the endpoint is **two URLs plus
three independent gates**:

- `GET .../purge/confirm` — renders the confirmation form with a
  free-text input that must contain the exact display name of the
  row. **404 (not 403) on a row that fails the precondition** — an
  active control's confirmation page never renders, so a hand-typed
  URL cannot surface the destructive form.
- `POST .../purge` — destroys. Refuses the same precondition with
  the same 404, then re-checks the typed name against the row's
  name **verbatim** (no trim, no case fold — the string on the
  confirmation page is what the professor sees, and a match must be
  what they type). Mismatch → 422 re-render with the typed value
  echoed back (same shape as the create form's validation
  re-render).

The three gates enforce the same rule at three layers so a caller
that bypasses one still hits the others:

1. **Schema:** the `DELETE` guards `WHERE ... AND <precondition>`. A
   caller that reaches directly into the store still cannot destroy
   a row that fails the precondition. Removing this `AND` is
   forbidden.
2. **Service:** the domain method pre-fetches the row, checks the
   same precondition and returns a **distinct sentinel** for the
   "precondition failed" case — kept separate from `NotFound` so
   the handler can render "you have to X first" rather than a bare
   404 on a URL against a wrong-state row.
3. **Handler:** verbatim string match on a form field the professor
   typed. Mismatch → 422 re-render with the typed value echoed
   back.

Every layer of consequence beyond the DB row is **best-effort AFTER
the load-bearing commit** — the DB `DELETE` commits, then
`os.RemoveAll` (or its equivalent) drops the on-disk state, and a
filesystem failure at that step is logged and swallowed. Forwarding
the FS error would leave the caller believing the destructive
operation failed when the row is already gone through the cascade
and every referenced downstream is already unrecoverable. Same
shape as `PrepareControl`'s rollback closure.

Worked case: `handler.PurgeConfirm`/`handler.Purge` (both refuse
`DeletedAt == nil` with 404), `Service.Purge` (returns
`ErrCannotPurgeActive` vs `ErrControlNotFound`), `Store.PurgeControl`
(`DELETE FROM control WHERE id = ? AND deleted_at IS NOT NULL`).

The related soft-delete step is the same shape without the third
gate: the state-flipping route is one POST, guarded by the schema's
`WHERE ... AND deleted_at IS NULL` clause, and idempotent by
returning `ErrControlNotFound` when the guard's `RowsAffected = 0`.
The handler translates the sentinel into an "already X" flash rather
than a 404 so a double-click is not a stack trace.

## Checklist

- [ ] The endpoint is on the right surface, and neither surface imports the other.
- [ ] The domain stayed pure; the interface is declared where it is consumed.
- [ ] Only `internal/infra/storage` names a driver; every query takes a context.
- [ ] The method is in the ServeMux pattern.
- [ ] A state-changing `web` route sits behind `RequireProfessor` **and**
      `VerifyCSRF`; nothing auth-shaped was mounted on `api`.
- [ ] Text a person reads is Spanish; identifiers, comments and tests are English.
- [ ] A new configuration variable is in all four homes (a test says so).
- [ ] A new dependency was discussed first (root `CLAUDE.md`).
- [ ] Every guard was seen to fail at its own assertion, named in the commit.
- [ ] The **per-commit protocol** passes before each commit and the **pre-PR
      protocol** before the PR — including `govulncheck` and the compose path,
      which is the only thing that sees whether the binary still starts on
      `scratch` (`testing-strategy.md` §`apps/server`).
- [ ] Docs the change obligated ship in the same PR
      (`documentation.md`), and an ADR exists if the change was architectural
      (`documentation.md` §Rules 2).
