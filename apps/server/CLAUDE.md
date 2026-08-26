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
page → re-leer con otra sensibilidad → *Cerrar corrección*. The routes
table in `README.md` is the current inventory.

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
- `docs/standards/guides/add-a-backend-endpoint.md` — read before adding ANY
  route here: which surface it belongs to, the handler → domain → repository
  chain, and the middleware a state-changing route needs.
- `README.md` §"What is not here yet" — before adding anything, check whether
  the work belongs to WP-D (roster) or WP-G (publish grades). **WP-C1,
  WP-C2, WP-C3, WP-E and WP-F are closed**: the layered layout (#149), the
  login round trip + session gate (#150), the backoffice shell + professor
  CRUD (#151), control creation with the PDF pipeline (#166) and the
  scans + review flow (#167) all live here.

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
- **The uploaded scan batch survives every downstream failure of
  `UploadScan` (issue #210).** Reintroducing `os.Remove(batchHostPath)` on
  a refusal — or on any post-copy error — is forbidden. The batch on disk
  is the artefact an operator inspects and what the professor would
  otherwise have to re-scan; erasing it on refusal was the pre-#210
  behavior that made the 2026-08-19 incident cost twenty SSH minutes to
  diagnose (same incident ADR-0042 §Context and the paper-check bullet
  above reference — that WP fixed the printer cause, this one fixes the
  diagnosis path). `writeUpload` still cleans a PARTIAL file (its own
  `io.Copy` failure); downstream failures do not. The rollback promise
  is scoped to DB rows, not the file — see the `UploadScan` docstring
  for what is transactional and what is not.
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
- **Bank text destined for the printed sheet MUST go through
  `escapeBankText` (issue #237).** The pipeline runs three ordered
  stages in `internal/domain/controls/tex/tex.go` — `escapeLatex` →
  `mapUnicodeToLatex` → the backtick-to-`\texttt` regex — and the
  order is load-bearing: `mapUnicodeToLatex` introduces `\` and `$`
  that `escapeLatex` would otherwise re-escape as `\textbackslash{}\$`
  if the two ran in the other order. A new path that emits Statement
  or Alternatives text into `.tex` outside `escapeBankText` will let
  bare Unicode (Θ ² √ ≤ → ∞ — …) reach pdftex and reproduce the exact
  `auto-multiple-choice prepare failed (1)` this WP set out to
  prevent. Extending the map: add the char to `unicodeReplacer` AND a
  matching row to `TestMapUnicodeToLatex_Round2` in `tex_internal_test.go`
  in the same PR (one row per character is the pin against a silent
  revert); author-facing summary is
  `docs/standards/guides/write-control-questions.md` §Unicode symbols.
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
