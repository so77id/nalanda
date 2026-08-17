# CLAUDE.md — server

## Description

The Nalanda backend: one Go binary, two delivery surfaces (the professor's
backoffice and a JSON/WS API for anonymous students), one shared domain,
SQLite underneath. Born with the entrance-controls subsystem
(`docs/design/2026-08-controles.md` §C10) rather than in the abstract.

Since WP-C3 (#151) the backoffice has its shell (nav, both themes, error
pages, one-shot flash cookie) and the professor CRUD. The login round trip
and the session gate arrived earlier with WP-C2 (#150).

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
- `docs/decisions/0037-the-jetson-is-the-first-test-bed.md` — where this app
  runs in production, and the operational triggers for hosting / rate-limiting
  / proxy-trust choices. Any change to the login path, a cookie read/write,
  or `NALANDA_PUBLIC_URL` needs it: the tests here pin the helpers, not their
  callers, and ADR-0037 is where the reasoning lives.
- `docs/standards/guides/add-a-backend-endpoint.md` — read before adding ANY
  route here: which surface it belongs to, the handler → domain → repository
  chain, and the middleware a state-changing route needs.
- `README.md` §"What is not here yet" — before adding anything, check whether
  the work belongs to WP-D (roster) or WP-E (control creation). **WP-C1,
  WP-C2 and WP-C3 are closed**: the layered layout (#149), the login round
  trip + session gate (#150), and the backoffice shell + professor CRUD
  (#151) all live here.

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

- **The dependency rule has THREE edges**, all enforced by
  `internal/architecture_test.go`, transitively:
  1. `internal/domain` imports neither `internal/app` nor `internal/infra`, nor
     any third-party package.
  2. **`internal/infra` does not import `internal/app`.** Adapters sit beneath
     the surfaces, not beside them. This edge was missing from the guard for a
     whole WP, and #150 is the one that pushed on it: `internal/infra/oidc` and
     `internal/infra/storage/authstore` both sit below the surface that uses
     them. The OAuth redirect URI is passed IN from the handler for exactly this
     reason — an adapter reading it from the surface would invert the layering.
  3. Neither delivery surface imports the other.

  When the domain needs something from outside, it declares the interface and
  infra implements it — `health.Prober`, implemented by `storage.Prober`, is the
  shape to copy. Full statement and the inversion recipe:
  `docs/standards/backend-code-style.md` §The dependency rule.
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
  itself (`Dockerfile`); infra places it. Adding a service or a volume is an
  edit to `infra/local/docker-compose.yml`. **A HOST-SPECIFIC production
  service** (`backup`, `monitor`, or the next one) is that same edit behind a
  `profiles: [<host>]` gate, with its own Dockerfile and scripts under
  `infra/deploy/<host>/` — worked case: `infra/deploy/jetson/` with the
  `jetson` profile (#162, ADR-0037, `docs/standards/repository-structure.md`
  §Placement criteria). A dev laptop's `docker compose up server` does NOT
  start profile-gated services; the Jetson invokes them with `--profile jetson`.
- **Cookie names are computed, not literal.** Since #162 (ADR-0037) both the
  session and OAuth-state cookies carry the `__Host-` prefix when
  `config.SecureCookie()` is true (production, https). Read and write them
  ONLY through `middleware.SessionCookieName(secure)` and
  `handler.StateCookieName(secure)`. A bare literal (`"nalanda_session"`,
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
