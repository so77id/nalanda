# ADR-0034: The backend is born with the controls, as one binary with two surfaces

**Status:** Accepted
**Date:** 2026-08-16
**Decision-makers:** Miguel Rodriguez
**Source:** #149 (WP-C1), design `docs/design/2026-08-controles.md` §C10, §C11

## Context

Nalanda had no backend. ADR-0006 chose Go for one and ADR-0007 chose SQLite
under it, but both were decisions about a service scheduled for v0.3 and neither
had produced a line of code. Meanwhile the entrance-controls subsystem arrived
with something the platform had never had: a concrete module, with a real user
(Miguel), that **cannot** be built client-side. Generating a printed control,
storing a roster, and writing grades are server work by nature.

That creates the question this ADR answers. Does the backend wait for v0.3 and
the controls subsystem wait with it — or does the controls module pull the
backend forward and become the reason it exists?

There is a second question underneath, and it is the one that shapes the code.
The server has two audiences that share almost nothing:

- **The professor**, working in a backoffice: authenticated, low traffic,
  server-rendered pages are the right tool and a SPA would be pure overhead.
- **The students**, reached from `apps/web`: anonymous, higher traffic, JSON
  and eventually WebSocket for live sessions (ADR-0008).

They disagree about rendering, authentication and shape of traffic. They agree
completely about the domain underneath: the same course, the same control, the
same grade.

`apps/web` had also just shown what happens when a boundary is only described.
Its `src/architecture.test.ts` enforces its seams because the alternative had
been documented rules nobody could see being broken. And DocumentBuddy — the
project this repo ports its auth domain from (ADR-0009) — records in its own
ADR-005 exactly what an unenforced layering costs: the dependency rule violated
in 13 files, 18 SQLite stores living in `domain/`, and 308 lines of OIDC inside
the domain.

## Decision

**The backend is born now, with the controls module, and its first WP is the app
itself.** `apps/server` exists as a Go module discharging every obligation of
`repository-structure.md` §How to add a new app, and containing no business
logic at all: it starts, opens SQLite, applies migrations, and answers
`/health`.

**One binary, two delivery surfaces, one shared domain.**

```
cmd/server/        wiring — the only main package
internal/domain/   business types and the interfaces they need — PURE
internal/app/web/  the professor's backoffice (server-rendered)
internal/app/api/  the JSON/WS surface for anonymous students
internal/infra/    adapters: config, storage, httpserver, httpjson, selfcheck
migrations/        goose SQL migrations, embedded
```

Both surfaces are drawn now, before there is traffic across either, so the
boundary is a starting condition rather than a refactor.

**The dependency rule is enforced by a test, not by good intentions.** Three
edges: `internal/domain` imports neither `internal/app` nor `internal/infra` nor
any third-party package; `internal/infra` does not import `internal/app`, since
adapters sit beneath the surfaces rather than beside them; and the two surfaces
do not import each other. When the domain
needs something outside itself it declares the interface and infra implements it
— `health.Prober`, implemented by `storage.Prober`, is the worked example.
`internal/architecture_test.go` walks the package graph and fails on violations,
transitive ones included.

**The layout is corrected on entry rather than ported.** ADR-0009 says the auth
domain comes from DocumentBuddy; its debt does not. Store implementations go to
`internal/infra/storage/`, OIDC and HTTP adapters to `internal/infra/`. Same
rule the repo already applies to `proof-of-concept/`.

**Toolchain**, fixed here; adding to it is a PR discussion (root `CLAUDE.md`):

| Choice | Why |
|---|---|
| `modernc.org/sqlite` | Pure-Go SQLite. No CGO is what makes the production image a 10 MB static binary on `scratch`. Validated in production by DocumentBuddy. |
| `github.com/pressly/goose/v3` | Migrations as SQL, embedded in the binary, applied at boot — the binary and the schema it expects ship together. |
| `net/http.ServeMux` | Method-and-pattern routing since Go 1.22. No router dependency; the POC's chi belonged to the Postgres era. |
| `testing` + `httptest` | No test framework: no vocabulary a reader has to learn before reading a test. |
| `log/slog` | No logging library. |

## Alternatives considered

- **Wait for v0.3 and build the backend in the abstract.** Rejected: a service
  designed without a first consumer gets the shape of its author's expectations
  rather than of a real need. The controls module is a better brief than a
  roadmap entry, and it is the module that is actually wanted.

- **Two binaries — a backoffice service and an API service.** Rejected. They
  share the whole domain, so the split buys independent deployment and pays for
  it with a synchronisation problem, a second build, a second deployment, and a
  network hop between halves of one transaction. On a minimal VPS running one
  professor's course, that is cost with no matching benefit. The module boundary
  is drawn anyway, so the split stays cheap if it is ever wanted — which is the
  actual reason `internal/app/api` exists today with almost nothing in it.

- **One surface, with the backoffice as a SPA against the JSON API.** Rejected:
  it makes every backoffice screen a client-side application with its own state,
  routing and auth handling, for a low-traffic tool used by one person. Server
  rendering is the smaller thing.

- **A flat `internal/` with no layering.** Rejected on the evidence in
  DocumentBuddy's ADR-005, which is what a flat layout looks like after two
  years.

- **Documenting the dependency rule instead of testing it.** Rejected for the
  same reason and the same evidence. Writing the rule down is what DocumentBuddy
  did.

- **Authenticating something in this WP so it does more than start.** Rejected:
  it would bury a language introduction — new toolchain, new CI job, new
  standards document — under a security-sensitive change and make both harder to
  review. That is why WP-C became C1/C2/C3.

## Consequences

- **Go is now a language of this monorepo**, with everything that implies:
  `backend-code-style.md` (ADR-0005), its own CI job with path filters that do
  not cross the other apps, both testing protocols registered, and registration
  in `.claude/workflow-bindings.md` — which every review lens reads first.

- **The production image is 10.3 MB on `scratch`, running as UID 65532.**
  Measured 2026-08-16 with `docker image inspect nalanda/server:dev --format
  '{{.Size}}'` on darwin/arm64: 10796375 bytes. This replaces
  the "~20 MB multi-stage Alpine build" that §C9 of the design assumed; the
  design doc is corrected in the same PR. The figure is reported, never gated —
  a test that reddens because a number moved teaches nothing (the rule
  `testing-strategy.md` states for `apps/amc-worker`).
  `CGO_ENABLED=0` is load-bearing: a future dependency needing CGO produces a
  build that succeeds and a container that cannot start. The suite cannot see
  this, so the pre-PR protocol ends in Docker.

- **`/health` reports the database, not just the process.** A check that only
  proves the listener accepted a connection lies exactly when it matters. The
  container healthcheck is the binary itself (`/server -health`), because
  `scratch` has no shell to run one with.

- **A missing configuration variable is a startup error naming it.** No zero
  value is ever taken as a default.

- **Migrating at boot is an accepted operational constraint, not only a
  convenience.** It buys "the binary and the schema it expects ship together",
  and it costs three things that are true from this WP onwards and are recorded
  here because no code path reveals them: exactly ONE instance may start at a
  time (two would apply migrations concurrently to the same file), the `+goose
  Down` blocks are never executed by anything and so are untested, and rolling
  a binary BACK over an applied migration is not supported. None of that binds
  today — hosting is deferred and there is one instance — which is what makes it
  an accepted constraint rather than a defect. Review trigger: the first deploy
  (§C15), or the first second replica.

- **The Postgres exit of ADR-0007 stays cheap**: only `internal/infra/storage`
  names a driver, and the dependency test keeps it that way.

- **WP-C2 (#150) and WP-C3 (#151) now have a floor to build on**, and WP-D and
  WP-E are unblocked as far as C is concerned.

- **Hosting is still deferred** (§C15). There is a Dockerfile and a dev compose
  service; there is no VPS, no Tailscale, no deploy workflow and no secrets
  management. The first deployment will be its own decision.

- **`migrations/00001_init.sql` is deliberately empty.** The WP creates no
  domain tables, but `//go:embed *.sql` will not compile over a directory
  without one, and an applied migration is what makes the boot path provable.
  WP-C2's users table replaces it.

## References

- ADR-0006 (Go) · ADR-0007 (SQLite first) · ADR-0008 (event envelope, why the
  API surface has no contracts yet) · ADR-0009 (professor-only auth, the port
  this layout is preparing for).
- ADR-0005 — the standards obligation a new language brings.
- `docs/design/2026-08-controles.md` §C10, §C11, §C15.
- `docs/standards/backend-code-style.md` · `apps/server/README.md`.
