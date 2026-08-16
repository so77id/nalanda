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
make build       # build the image
make test        # every verification script (per-commit protocol)
make verify      # build, then test (pre-PR protocol)
make serve       # run the HTTP wrapper on localhost:8080
make shell       # interactive shell in the image, for exploring AMC by hand
make measure     # time a real-sized batch — reports, never asserts (COPIES=40)
make paper       # produce the printable control for the manual paper check
make read-paper  # read the scanned batch back (see PAPER-CHECK.md)
make size        # report image size
make clean       # remove generated work directories, keep the image
```

**On an Intel/AMD host, pass `PLATFORM=linux/amd64`.** The default is
`linux/arm64` — the machine this was built on — so `make build` alone
cross-builds elsewhere. CI passes the flag explicitly. `IMAGE` overrides the tag.

**After editing `worker.py`, `read_capture.py` or the `Dockerfile`, run
`make build` before `make test`.** The suite runs the copy baked into the image,
so code you never built goes green.

Under `infra/local/`, `docker compose up amc-worker` brings it up alongside the
other services — that file is where `apps/server` will meet it.

## How it is driven

Work crosses a **shared volume**, not the wire. The caller writes an AMC project
under `/work` and asks the worker to act on it; requests and responses name
paths. A scan batch is a multi-page PDF of ~40 sheets, and putting that through
an HTTP body would buy nothing.

```
GET  /health                                          → { ok, amc }
POST /generate      { project, source, copies }       → { sujet, corrige, calage, copies }
POST /analyse       { project, scan_pdf, source }     → { pages, copies, needs_review }
                    ⏱ MINUTES-CLASS — background job only, see below
POST /associate     { project, roster, code, key }    → { associations, refused_codes }
POST /associate/set { project, copy, id }             → { copy, id, source }
POST /annotate      { project, roster, key, out,      → { pdfs, unidentified }
                      [name_column], [verdict] }
```

Every failure answers `{ error, detail }`. **400** is the caller's mistake and
can never succeed on retry — a missing or malformed field, a path outside
`/work`, a non-empty annotation directory, or AMC refusing the work. **500** is
ours. Bodies are capped at 1 MiB and no AMC call outlives 30 minutes.

The full `/analyse` report schema is the module docstring of `read_capture.py`;
its shape is a contract in its own right (ADR-0031), not an implementation
detail.

**Two obligations on the caller** are recorded in `docs/security-notes.md`
§The control worker is unauthenticated: never log an error `detail` — it can
contain student identifiers — and never hand the worker a project directory
containing symlinks, because paths derived from the project root are not
re-resolved.

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
| `03-read.sh` | A scrambled multi-page PDF batch reads back; ambiguous marks and unreadable identifiers are reported separately; multiple-answer questions score and are not called ambiguous; a project with no scoring database is refused |
| `04-associate.sh` | Clean copies match a roster automatically; damaged identifiers fail closed; an association can be injected from outside without the GUI |
| `05-annotate.sh` | One annotated PDF per student, carrying their marks, the correct answers and per-question scores |
| `06-http.sh` | The whole flow over the HTTP contract; the annotate and unknown-subcommand guards exercised by performing the trap inside the image (the association trap belongs to `04-associate.sh`) |

They are shell scripts rather than a test framework because the subject under
test is a container image and a third-party CLI — the subject is `docker run`,
and a framework would only wrap it.

`tests/tools/fill_sheet.py` blackens boxes at the coordinates AMC's layout
database reports, producing a scan batch without paper. It is deliberately not
a worker route: production never fills a sheet, it receives one off a scanner.

**A synthetic batch proves the plumbing and nothing about paper.** Whether the
reader tolerates a real pencil, a real scanner and a page that went in slightly
rotated is the one check no agent can run — and it is the check that decides the
engine. A green run here is not evidence the thing works. The procedure is
`PAPER-CHECK.md`: print, mark six sheets badly on purpose, scan, read, compare.
Fifteen minutes, and its outcome is recorded in ADR-0030 §Not yet proven.

Measurements (image size, batch timings) are **reported**, never asserted: a
test that fails because a number moved teaches nothing about correctness. They
are collected in the ADR that closes #138.

## Four traps in AMC that this worker exists to neutralise

All four are silent, all four were measured rather than read about, and each
yields a system that looks like it works while losing a student's grade. The
wrapper refuses each; `tests/06-http.sh` asks it to do the wrong thing —
**inside the image** — and checks that it does. (An earlier version asserted the
fourth by grepping this file for its error message, which would have passed with
the guard deleted.)

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

**`auto-multiple-choice <anything>` hands an unrecognised subcommand to the GTK
GUI**, which then dies on `cannot open display`. Subcommands are chosen from a
fixed set in `worker.py`, so a typo is an error there rather than an
unexplainable Gtk message in a log.

## What the reader reports, and what it cannot

`/analyse` returns a per-copy report with **three** failure kinds, kept apart
because they need different repairs:

| Status | Means | Repair |
| --- | --- | --- |
| `rut_status: unreadable` | who is this — a blank or doubled RUT column | type eight digits |
| answer `blank` / `ambiguous` / `doubtful` | what did they mark | a human looks at the sheet |
| `status: incomplete` | the copy printed questions this batch never captured | find the sheet and scan it again |

A box above `ticked` (0.30) is marked; above `unsure` (0.10) it is **doubtful**
and reported separately, never counted as an answer. That band is where a
half-erased pencil lands, and it is the one region a solid synthetic fill (~0.63)
can never reach — so it is exercised by its own batch in `03-read.sh`.

**Each answer says which kind of question it is** — `type: "simple"` or
`type: "multiple"` — and on a multiple one **several marks are the answer**, not
an ambiguity. Only a simple question with more than one mark is `ambiguous`.

**Each answer also carries `score` and `max`, and the caller does the
arithmetic**, because every question weighs one point (§C7) and AMC does not
agree: it weighs a simple question 1 and a multiple one point per alternative.

```
relative_i = score_i / max_i          the fraction of question i's single point
grade      = sum(relative_i)          over the N questions THIS copy drew
percentage = grade / N                out of N, because each question is one point
```

`max` is **not a constant** — 1 for a simple question, the alternative count for
a multiple — so a three-alternative multiple divides by 3 and a five-alternative
one by 5. Nothing in the formula assumes four, which is why `max` travels with
each answer instead of being assumed by the caller. Turning a percentage into a
1,0–7,0 mark is `apps/server`'s job, not this report's.

Measured on a four-alternative question with two correct alternatives: both
correct → 4/4; one correct and nothing wrong → 3/4; only a wrong one → 1/4;
**every box ticked → 2/4**; blank → 0/4. Ticking everything does not win, and no
score comes back negative.

**The report says which threshold those scores were computed at.** AMC's `note`
scores at its own `--seuil` while `--ticked` is ours and tunable, so a re-read of
a stored capture at another sensitivity moves the marks and leaves the scores
where they were. `scoring: {seuil, ticked, stale}` carries both and flags the
disagreement rather than hiding it.

**Reading requires a SCORED batch**, not only a captured one: the reader opens
`scoring.sqlite` as well, which exists only after `prepare --mode b` and `note`
have run (in that order, and after `analyse`). `/analyse` does it; a caller
driving the CLI by hand must too. A project without it is refused with a message
naming the missing command — measured, the half-done state is the dangerous one,
because `prepare --mode b` alone leaves the scoring tables present and empty.

**And it must have been scored AFTER the last capture.** A question that was
captured but never scored is refused too, per copy, because the repair is
re-running `note` rather than a human looking at the sheet. Pass `--n-copies` to
`prepare --mode b`: without it AMC scores only the copies the source declares in
`\onecopy{N}`, so printing a class larger than that default gives copies that
are captured and never scored. Measured on the paper check itself — six printed
against a source declaring five, and copy 6 came back with every score null,
`status: "ok"`, absent from `needs_review`, exit 0.

**`/analyse` is a minutes-class call** — 53 s for a class of forty, three
quarters of it in `getimages`, which AMC does not parallelise. `apps/server`
must drive it as a background job with a status endpoint, never inside a request
a browser is holding open. The server is threaded so `/health` answers during
it; AMC work itself is serialised, because its state is sqlite files in the
project directory and two runs over one project would race them.

## What a control source must contain

`/generate` compiles a `.tex` you supply. WP-E generates that file from the
published question bank, and these are its load-bearing parts — the worked
example is `tests/fixtures/control-demo.tex`:

```latex
\usepackage[box,lang=ES]{automultiplechoice}   % NOT completemulti — see below
\AMCrandomseed{1242}          % fixed seed → a reproducible draw
\def\unaSymbole{\textsf{\small(una respuesta)}}
\def\multiSymbole{\textsf{\small(varias respuestas)}}
...
\element{clase}{\begin{question}[\unaSymbole]{indice} ... \end{question}}
\element{clase}{\begin{questionmult}{comparar-cadenas}
  ... \lastchoices \wrongchoice{Ninguna de las anteriores} ... \end{questionmult}}
\element{clase}{\begin{question}[\unaSymbole]{suma-arreglo}
  \lstinputlisting{/work/src/code/suma-arreglo.java} ... \end{question}}
\onecopy{5}{
  \AMCcode{rut}{8}            % the 8-digit RUT grid, no verifier digit
  \shufflegroup{clase}
  \insertgroup[4]{clase}      % draw four of the pool
  \AMCcleardoublepage
}
```

- **`lang=ES` is not cosmetic.** Without it AMC labels every question
  "Question 1" in English, on a sheet a Spanish-speaking student reads — past a
  green compile, because nothing about a wrong-language label makes LaTeX fail.
- **The question name is the join key.** `\begin{question}{indice}` is what comes
  back as `answers[].name` in the reading report, which is what the design's
  `control_pregunta.pregunta_ref` joins to. Generate it from the bank's question
  id and nothing else.
- **`--n-copies` overrides `\onecopy{N}`**, so the number in the source is a
  default, not a constraint.
- **`completemulti` is off, deliberately.** It appended AMC's own "none of
  these" box to every multiple-answer question — all-or-nothing, with Spanish
  AMC gets wrong ("Ninguna de estas preguntas son correctas"), and it numbered
  that question's alternatives from **0** while simple questions started at 1.
  With it off both types number `1…N`. A question that wants that alternative
  writes it by hand, and **pins it with `\lastchoices`**: alternatives shuffle,
  and "ninguna de las anteriores" printed second says something false.
- **Every question states its type in words**, for both kinds, because a student
  under a five-minute clock cannot scroll back to learn a convention. It takes
  two levers: a simple question takes the label as its optional argument, and a
  `questionmult` cannot — its own definition already passes `\multiSymbole` into
  that slot, so redefining `\multiSymbole` is the way in.
- **Code comes from a FILE, by absolute path.** `verbatim` does not compile
  inside an AMC question, and `\lstinputlisting` with a path relative to the
  `.tex` does not resolve — AMC compiles from its own working directory, and it
  fails fatally with no PDF. Everything the worker is handed lives under
  `/work`, so that is the path. That is also why the bank keeps code as its own
  field: nothing has to be escaped.
- **Anything the source reads must be staged beside it.** `tests/lib.sh`'s
  `stage_source` does that for the suite; `make paper` keeps its own copy of
  those two lines.
- **Each copy is two PDF pages**, padded to an even count. Printed duplex that
  is one physical sheet per student; it does mean the scan has a back side for
  every sheet.

## Code

- `worker.py` — the HTTP contract.
- `read_capture.py` — turns an AMC capture into a JSON reading report. Note the
  underscore: a hyphenated module can be run and cannot be imported, and the
  wrapper imports this one.

Python here is stdlib-only and follows `docs/standards/python-code-style.md`.
