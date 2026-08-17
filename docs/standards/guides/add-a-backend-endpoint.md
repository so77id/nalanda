# Add a backend endpoint

The extension point `apps/server` exists to be extended through: one HTTP route,
the domain behind it, the repository under that, and the tests that hold all
three honest.

Deferred from #149 on purpose — a guide written against a worked example that
does not exist is fiction — and written by #150, which produced the first real
chain: a route, a domain service, three repositories and a migration.

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
