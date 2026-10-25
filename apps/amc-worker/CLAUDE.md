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
  and the rules for writing a verification script here. Read the whole
  section; several exist because they were violated once.
- `docs/decisions/0030-…` (the engine and its traps) and `0031-…` (the reading
  report, which is the contract WP-F and WP-G bind to).
- `README.md` §Five traps — the AMC behaviours that silently lose a grade —
  and §A sheet printed to fit the page is read, the one that is not silent
  (a copy `incomplete` while its page is in the batch) and its diagnosis.

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
- **The rules for verification scripts live in
  `docs/standards/testing-strategy.md` §`apps/amc-worker`** — among them: they are the tests;
  a measurement is reported rather than asserted; a trap is tested by performing
  it rather than by reading the wrapper; a trap performed on a degraded input
  also proves the pipeline reads at the identity setting and that the system
  saw the degradation (#327); and a test runs against the artifact rather than
  the working tree. Read the whole section before adding a script — it holds
  more than this list (a script never writes into a project the worker has
  touched; a fixture added to kill a mutant names it). This file used to
  paraphrase the first two and silently omit the others.
- **Anything the caller passes crosses the volume, not the wire.** Requests name
  paths under `/work`; PDFs and scans never travel as HTTP bodies.
- **`/work/incoming/` belongs to `apps/server`** (chunked-upload partials,
  ADR-0088). The worker never reads, writes, lists or cleans it, and an
  operation that walks `/work` as a whole must skip it: anything else writing
  there is a review trigger in `docs/security-notes.md` §"Chunked uploads read
  the shared volume defensively".
- **A new field in the `/analyse` or `/reanalyse` response body is
  OPTIONAL on the wire.** The server merges FIRST — this repo ships
  server and worker in the same monorepo but each has its own CD
  workflow, so their versions can drift on the Jetson for up to ~5
  minutes across a merge — and `apps/server/internal/infra/amcworker/
  analyze.go`'s `toDomain` substitutes a legacy default when the field
  is absent. A worker upgraded ahead of the server must not break the
  server, and vice versa. Worked cases: `pages_per_copy` → substitute
  `[1]` per copy (#243); the per-answer `position` + `alternatives`
  → substitute 0 / empty and iterate in bank order (#229); `batch` →
  `Client.Analyze` (not `toDomain`, since `/reanalyse` has none)
  substitutes captured = `pages.captured`, nothing failed or re-captured
  (#298). Adding a
  required field is forbidden; renaming or removing one is a wire
  break and needs its own coordination — same rule shape as
  `ADR-0031`'s "reversal test" for engine-independent fields.
- **The worker never captures in photocopy mode (issue #298, ADR-0075).**
  `analyse` runs WITHOUT `--multiple`, over a page list of its own per batch
  (`scans/list-<batch>.txt`): a re-scanned page overwrites its capture at
  `copy = 0`. `--multiple` stacks re-scans under `copy` 1, 2, … and the
  reader keys by copy number — the Control 7 incident. Three things lean on
  it and move with it: an association is written under the index the
  CAPTURE carries (`scan_copy`, never a literal); a re-captured copy's
  `manual` column is reset before `note` (`forget_corrections`); and
  `read_capture` refuses a copy captured under MORE than one index rather
  than concatenate it (a legacy copy at index 1 alone still reads). Driving
  AMC by hand in a test or a Makefile target follows the same mode.
- **Every read of real paper runs `analyse` with `--tol-marque
  MARK_TOLERANCE` (issue #327, ADR-0085)** — the worker's `/analyse`, and the
  Makefile targets that read a scanned pile (`read-paper`, `read-paper-min`),
  which take it from the image's own `worker.py`, never a copy. The professor
  prints "fit to page", and AMC's default ±20 % corner-mark size filter drops
  the circles of a sheet that came back at 0.87. A test or measurement that
  drives AMC by hand on a 100 % synthetic batch may omit it (03, 04, 05, 07
  and `measure-batch.sh` do — at 100 % the band changes nothing), and
  `09-scaled.sh`'s bare read omits it ON PURPOSE — that is the trap; adding
  the flag there defuses it. When changing the value: `make build` first,
  then `make measure-scale` (each line names the tolerance it read from the
  image — check it is the new one) and `tests/09-scaled.sh`. Those bound it
  from BELOW only: a far wider value keeps every script green. Any change
  must also pass `tests/tools/regress-tolerance.py` on the Jetson — the #327
  production regression, read-only, comparing placement, transforms and box
  verdicts between the old and the new value — run it with `--old <the
  deployed MARK_TOLERANCE> --new <candidate>`: its `--old` DEFAULTS to AMC's
  own band, which is the #327 comparison, not a change of the value. Its
  docstring has the command and what a report of it may record (counts only —
  the scans are students' sheets).
- **`/scans/reset` empties what a capture produced and nothing else.** The
  layout and `inputs/` are what the paper was printed from and are
  irreplaceable once students wrote on it; `RESET_FILES` / `RESET_DIRS` in
  `worker.py` are the whole list. The server calls it before its own
  deletes, so this route must fail loudly rather than half-reset.
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
