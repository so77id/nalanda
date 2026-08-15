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

The HTTP contract itself arrives with the wrapper (S6 of #138):

```
POST /generate    { tex, copies }        → { pdf, layout }
POST /analyse     { scan_pdf, project }  → { readings, ambiguous, unread }
POST /associate   { project, pairs }     → { associated, rejected }
POST /annotate    { project }            → { pdfs[] }
```

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

They are shell scripts rather than a test framework because the subject under
test is a container image and a third-party CLI — the subject is `docker run`,
and a framework would only wrap it.

`tests/tools/` holds the two scripts that run inside the image:
`fill-sheet.py` blackens boxes at the coordinates AMC's layout database
reports, producing a scan batch without paper; `read-capture.py` turns AMC's
capture into a JSON reading report.

**A synthetic batch proves the plumbing and nothing about paper.** Whether the
reader tolerates a real pencil, a real scanner and a page that went in slightly
rotated is the manual cycle in S7 of #138 — and that is the check that decides
the engine.

Measurements (image size, batch timings) are **reported**, never asserted: a
test that fails because a number moved teaches nothing about correctness. They
are collected in the ADR that closes #138.
