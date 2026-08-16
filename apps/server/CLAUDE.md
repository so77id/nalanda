# CLAUDE.md — server

## Description

The Nalanda backend: one Go binary, two delivery surfaces (the professor's
backoffice and a JSON/WS API for anonymous students), one shared domain,
SQLite underneath. Born with the entrance-controls subsystem
(`docs/design/2026-08-controles.md` §C10) rather than in the abstract.

Commands, stack, configuration and layout live in `README.md` — one home per
fact.

## Mandatory reading

- `docs/standards/backend-code-style.md` — the dependency rule and how to invert
  it, the error and configuration contracts, the HTTP and database rules. Agents
  follow it; they do not innovate on it.
- `docs/standards/testing-strategy.md` §`apps/server` — the two protocols, and
  §"What this level cannot see", which is why the pre-PR one ends in Docker.
- `docs/decisions/0033-the-backend-is-born-with-the-controls.md` — the layered
  layout and why microservices were rejected. Also ADR-0006 (Go), ADR-0007
  (SQLite first, and the Postgres exit), ADR-0009 (professor-only auth).
- `README.md` §"What is not here yet" — before adding anything, check whether it
  belongs to WP-C2 (#150), WP-C3 (#151), WP-D or WP-E.

## Language

Code, comments, identifiers, tests and commit messages in **English**, like the
rest of the repo.

**Everything a person reads is Spanish** — which on this app means the
backoffice's rendered text when WP-C3 brings it, and any message that reaches a
student. Same rule as `content/` and as the LaTeX in `apps/amc-worker`: English
stays inside identifiers. Log lines are English: their reader is an operator
looking at the same identifiers.

## Rules for Claude

- **`internal/domain` imports neither `internal/app` nor `internal/infra`, and
  no third-party package.** When the domain needs something from outside, it
  declares the interface and infra implements it — `health.Prober`, implemented
  by `storage.Prober`, is the shape to copy. `internal/architecture_test.go`
  enforces this and sees transitive violations too.
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
  edit to `infra/local/docker-compose.yml`.
- The database file, its `-wal`/`-shm` siblings and a locally built binary are
  gitignored. Never commit `.env`.

## Testing protocols

Registered in `docs/standards/testing-strategy.md` (the two-protocol rule).

- **Per-commit**: `gofmt -l .` (must print NOTHING — it exits 0 either way, so
  the status is not the gate), then `go vet ./...`, `go build ./...`,
  `go test ./...`.
- **Pre-PR**: the above plus `go test -race -count=1 ./...`, `docker build`, and
  the compose path from `infra/local/` (`up -d --wait server`, then
  `curl -fsS /health`).

**`-count=1` is not decoration** — see the cache note above. **And the image is
RUN, not only built**: the suite cannot see whether the binary starts on
`scratch`, whether UID 65532 can write the volume, or whether the healthcheck
the compose file names exists in the image. That last one did not, once (#149
S6).

Green means exit status 0, with the `gofmt` exception.
