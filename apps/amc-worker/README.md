# amc-worker

Auto-Multiple-Choice (AMC) as a container, driven from the CLI with no GUI.
Generates printable multiple-choice control sheets and reads them back from
scans, for the entrance-controls subsystem.

Design and the decisions behind it: `docs/design/2026-08-controles.md`.

## Stack

- **Debian bookworm** + `auto-multiple-choice` 1.6.0 (Debian package)
- **TeX Live** 2022 — compiles the generated `.tex` into the printable PDF
- **OpenCV** 4.6 — AMC's scan reader, via the package's own bindings
- **Poppler / Ghostscript** — page extraction from a scanned PDF

Native on `arm64` and `amd64` alike: `auto-multiple-choice` ships for both in
Debian bookworm, so Apple Silicon runs it without emulation.

## Commands

Everything runs in Docker. Nothing is installed on the host.

```bash
make serve      # run the HTTP wrapper on localhost:8080
make build      # build the image
make test       # run every verification script (per-commit protocol)
make verify     # build, then test (pre-PR protocol)
make shell      # interactive shell in the image, for exploring AMC by hand
make size       # report image size
make clean      # remove generated work directories, keep the image
```

Under `infra/local/`, `docker compose up amc-worker` brings it up alongside the
other services — that file is where `apps/server` will meet it.

## How it is driven

Work crosses a **shared volume**, not the wire. The caller writes an AMC project
under `/work` and asks the worker to act on it; requests and responses name
paths. A scan batch is a multi-page PDF of ~40 sheets, and putting that through
an HTTP body would buy nothing.

```
GET  /health                                        → { ok, amc }
POST /generate      { project, source, copies }     → { sujet, corrige, calage }
POST /analyse       { project, scan_pdf, source }   → { pages, copies, needs_review }
POST /associate     { project, roster, code, key }  → { associations, refused_codes }
POST /associate/set { project, copy, id }           → { copy, id, source }
POST /annotate      { project, roster, key, out }   → { pdfs, unidentified }
```

The worker has **no authentication and never will**. It is reachable only by
`apps/server` over the compose network, and `infra/local/docker-compose.yml`
binds its published port to loopback. Paths in a request are resolved and
refused if they escape `/work`.

## Headless is a property of the image, not a habit of the caller

The container runs with `DISPLAY` empty and no X socket mounted, so a code path
that reaches the GTK interface dies rather than quietly working on a developer's
machine and failing on a server.

Note that the GTK stack **is** in the image: `auto-multiple-choice-common`
depends on `libgtk3-perl` and packaging cannot exclude it. So the guarantee is
not "no GUI exists" — it is "no display exists, and the CLI does not need one".
`tests/01-headless.sh` asserts exactly that and no more.

## Tests

`tests/NN-*.sh`, one per acceptance criterion of #138, each re-runnable alone:

| Script | Proves |
| ------ | ------ |
| `01-headless.sh` | AMC runs from the CLI with no display; LaTeX resolves `automultiplechoice.sty`; every CLI tool the pipeline needs is present |
| `02-generate.sh` | N copies from our own `.tex`, questions and alternatives shuffled per copy, an 8-digit RUT grid, a printed identifier per page, a reproducible draw |
| `03-read.sh` | A scrambled multi-page PDF batch reads back; ambiguous marks and unreadable identifiers are reported separately |
| `04-associate.sh` | Clean copies match a roster automatically; damaged identifiers fail closed; an association can be injected from outside without the GUI |
| `05-annotate.sh` | One annotated PDF per student, carrying their marks, the correct answers and per-question scores |
| `06-http.sh` | The whole flow driven over the HTTP contract, and each of the three traps below refused when asked for |

They are shell scripts rather than a test framework because the subject under
test is a container image and a third-party CLI — the subject is `docker run`,
and a framework would only wrap it.

`tests/tools/fill-sheet.py` blackens boxes at the coordinates AMC's layout
database reports, producing a scan batch without paper. It is deliberately not
a worker route: production never fills a sheet, it receives one off a scanner.

**A synthetic batch proves the plumbing and nothing about paper.** Whether the
reader tolerates a real pencil, a real scanner and a page that went in slightly
rotated is the manual cycle in S7 of #138 — and that is the check that decides
the engine. A green run here is not evidence the thing works.

Measurements (image size, batch timings) are **reported**, never asserted: a
test that fails because a number moved teaches nothing about correctness. They
are collected in the ADR that closes #138.

## Three traps in AMC that this worker exists to neutralise

All three are silent, all three were measured rather than read about, and each
yields a system that looks like it works while losing a student's grade. The
wrapper refuses each; `tests/06-http.sh` asks it to do the wrong thing and
checks that it does.

**`association --set` without `--copy` does nothing.** It exits 0, prints
nothing, and writes a row AMC's own listing ignores. A review queue built on
that call looks like it works and the grade never lands. `/associate/set`
always sends `--copy`, and reads the association back before reporting success.

**An unassociated copy still gets an annotated PDF**, named with the literal
placeholder `_ID_`. So counting files is not a completeness check — five copies
yield five files whether or not anyone knows who two of them belong to.
`/annotate` reports the named and the unidentified as separate lists.

**`annotate` writes but never cleans.** Re-annotating into a directory that
already holds a previous run leaves stale files beside the new ones, and
anything walking the directory sends both. `/annotate` refuses a directory that
is not empty.

And a fourth, in the dispatcher itself: `auto-multiple-choice <anything>` hands
an unrecognised subcommand to the GTK GUI, which then dies on `cannot open
display`. Subcommands are chosen from a fixed set in `worker.py`, so a typo is
an error there rather than an unexplainable Gtk message in a log.

## Code

- `worker.py` — the HTTP contract.
- `read_capture.py` — turns an AMC capture into a JSON reading report. Note the
  underscore: a hyphenated module can be run and cannot be imported, and the
  wrapper imports this one.

Python here is stdlib-only and follows `docs/standards/python-code-style.md`.
