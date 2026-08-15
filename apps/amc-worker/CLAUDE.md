# CLAUDE.md — amc-worker

## Description

Auto-Multiple-Choice (AMC) packaged as a container and driven from the CLI, with
no GUI. It generates printable multiple-choice control sheets and reads them
back from scans, for the entrance-controls subsystem
(`docs/design/2026-08-controles.md`).

Commands and stack live in `README.md` — one home per fact.

## Language

Code, comments, identifiers, scripts and commit messages in **English**, like
the rest of the repo.

**The LaTeX this worker compiles is course material and is Spanish** — question
statements, alternatives, and any instruction printed on the sheet a student
reads. The same rule as `content/`: everything the reader can perceive is
Spanish, English stays inside identifiers. A `.tex` fixture under `tests/` is
test data and may be either, but anything shaped like a real control sheet is
written the way a real one would be.

## Rules for Claude

- **Nothing is installed on the host.** AMC is a Debian package with an OpenCV
  and LaTeX dependency tree that has no good native path on macOS. Every command
  goes through Docker; if a step seems to need a local install, it is the wrong
  step.
- **Never mount an X socket, and never set `DISPLAY` to a real value.** Headless
  is the property this worker exists to have. The GTK stack is present in the
  image because `auto-multiple-choice-common` depends on it and packaging cannot
  exclude it — so nothing prevents a code path from reaching a display except
  the fact that there is none. Adding one would make a broken change pass here
  and fail on a server.
- **Do not add an `ENTRYPOINT` until the HTTP wrapper exists.** The image is
  driven with explicit commands; an entry point now is only something to
  override.
- **Verification scripts are the tests.** What is under test is a container
  image and a third-party CLI, so the subject is `docker run` and a test
  framework would only wrap it. Each `tests/NN-*.sh` answers one acceptance
  criterion and is re-runnable alone.
- **A measurement is reported, not asserted.** Image size and batch timings are
  recorded with `note`, never turned into a threshold nobody agreed. A test that
  fails because a number moved teaches nothing about correctness.
- **Anything the caller passes crosses the volume, not the wire.** Requests name
  paths under `/work`; PDFs and scans never travel as HTTP bodies.

## Testing protocols

Registered in `docs/standards/testing-strategy.md` (the two-protocol rule).

- **Per-commit**: `make test` — every `tests/NN-*.sh` against the current image.
- **Pre-PR**: `make verify` — rebuild the image from scratch, then the full set.

Green means exit status 0.
