# CLAUDE.md — amc-worker

## Description

Auto-Multiple-Choice (AMC) packaged as a container and driven from the CLI, with
no GUI. It generates printable multiple-choice control sheets and reads them
back from scans, for the entrance-controls subsystem
(`docs/design/2026-08-controles.md`).

Commands and stack live in `README.md` — one home per fact.

## Mandatory reading

- `docs/standards/python-code-style.md` — stdlib only, no manifest, the
  subprocess rules (argument lists, a `timeout` on every call, a caller value
  only ever in a flag's value slot) and how a request-supplied path is resolved.
- `docs/standards/testing-strategy.md` §`apps/amc-worker` — the two protocols
  and the **four** rules for writing a verification script here. Read all four;
  two of them exist because they were violated once.
- `docs/decisions/0030-…` (the engine and its traps) and `0031-…` (the reading
  report, which is the contract WP-F and WP-G bind to).
- `README.md` §Four traps — the AMC behaviours that silently lose a grade.

## Language

Code, comments, identifiers, scripts and commit messages in **English**, like
the rest of the repo.

**The LaTeX this worker compiles is course material and is Spanish** — question
statements, alternatives, and any instruction printed on the sheet a student
reads. The same rule as `content/`: everything the reader can perceive is
Spanish, English stays inside identifiers. A `.tex` fixture under `tests/` is
test data and may be either, but anything shaped like a real control sheet is
written the way a real one would be.

**So is code typeset onto the sheet.** A `.java` under `tests/fixtures/code/`
is read by a student inside a question, so its identifiers and comments are
Spanish, like a code sample in `content/`. English stays in the harness around
it — script names, test titles, the fixture's own comments.

## Rules for Claude

- **On your dev host, nothing is installed.** AMC is a Debian package with an
  OpenCV and LaTeX dependency tree that has no good native path on macOS. Every
  command goes through Docker; if a step seems to need a local install, it is
  the wrong step. (Production is the Jetson, which runs the same image —
  ADR-0038 and the Deployment section below.)
- **Never mount an X socket, and never set `DISPLAY` to a real value.** Headless
  is the property this worker exists to have. The GTK stack is present in the
  image because `auto-multiple-choice-common` depends on it and packaging cannot
  exclude it — so nothing prevents a code path from reaching a display except
  the fact that there is none. Adding one would make a broken change pass here
  and fail on a server.
- **The image keeps a `CMD` (the HTTP wrapper) and never an `ENTRYPOINT`.**
  Every verification script, `make shell` and `make paper` override the command
  with a bare `auto-multiple-choice …` call; an `ENTRYPOINT` would bury the CLI
  underneath the server and break all of them.
- **The four rules for verification scripts live in
  `docs/standards/testing-strategy.md` §`apps/amc-worker`** — they are the tests;
  a measurement is reported rather than asserted; a trap is tested by performing
  it rather than by reading the wrapper; and a test runs against the artifact
  rather than the working tree. Read all four before adding a script. This file
  used to paraphrase the first two and silently omit the others.
- **Anything the caller passes crosses the volume, not the wire.** Requests name
  paths under `/work`; PDFs and scans never travel as HTTP bodies.
- **A new field in the `/analyse` or `/reanalyse` response body is
  OPTIONAL on the wire.** The server merges FIRST — this repo ships
  server and worker in the same monorepo but each has its own CD
  workflow, so their versions can drift on the Jetson for up to ~5
  minutes across a merge — and `apps/server/internal/infra/amcworker/
  analyze.go`'s `toDomain` substitutes a legacy default when the field
  is absent. A worker upgraded ahead of the server must not break the
  server, and vice versa. Worked cases: `pages_per_copy` → substitute
  `[1]` per copy (#243); the per-answer `position` + `alternatives`
  → substitute 0 / empty and iterate in bank order (#229). Adding a
  required field is forbidden; renaming or removing one is a wire
  break and needs its own coordination — same rule shape as
  `ADR-0031`'s "reversal test" for engine-independent fields.
- **Never run `apt-get install` inside the image, and never add a package
  without discussing it.** `texlive-fonts-extra` is purged with
  `--force-depends`, so the package database is deliberately inconsistent
  (ADR-0030 §Operational). The Dockerfile's package set is this app's manifest,
  and the root `CLAUDE.md` rule about manifests applies to it.
- **A merge to `main` reaches the Jetson.** Since #175 (ADR-0038), edits to
  `worker.py`, `read_capture.py`, `Dockerfile` or anything under
  `apps/amc-worker/**` trigger `.github/workflows/amc-worker-cd.yml`, which
  cross-compiles arm64 and pushes `ghcr.io/so77id/nalanda-amc-worker:latest`
  to GHCR. Watchtower on the Jetson (shared with DocumentBuddy) pulls and
  restarts within ≤5 min. Two consequences for edits here:
  1. **`make test` alone is not enough for a change that reaches the sheet.**
     The suite drives synthetic PDFs; `apps/amc-worker/PAPER-CHECK.md` is the
     L8 procedure a human runs against real paper. Read it before merging any
     change that affects generation, reading, or grading — the same rule as
     `apps/server/GOOGLE-CHECK.md` for auth changes.
  2. **The container runs on a Nano shared with DocumentBuddy** (~4 GB RAM,
     16 GB eMMC). A change that inflates image size or peak RSS lands on the
     box within minutes of merge, and can OOM the co-tenant. If a diff pulls
     in a heavy package, measure locally first; ADR-0038 §Decision holds the
     measurement block for the co-tenancy.

## Testing protocols

Registered in `docs/standards/testing-strategy.md` (the two-protocol rule).

- **Per-commit**: `make test` — every `tests/NN-*.sh` against the current image.
  **`make build && make test` whenever the change touches `worker.py`,
  `read_capture.py` or the `Dockerfile`**: `make test` alone runs the copy baked
  into the image, so code you never built goes green.
- **Pre-PR**: `make verify` — rebuilds the image (Docker's layer cache applies;
  add `--no-cache` by hand when the apt layer is what you doubt), then the full
  set.

Green means exit status 0.

The paper check — the one verification no agent can run — is `PAPER-CHECK.md`
(`make paper` → print → mark → scan → `make read-paper`). Its outcome is
recorded in ADR-0030 §Not yet proven.
