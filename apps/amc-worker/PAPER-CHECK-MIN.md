# The minimum paper check

The version of `PAPER-CHECK.md` for iterating on ONE variable at a time.

**Origin.** The full paper check burns six sheets × two pages per cycle, which is
too much paper when the question under test is a single yes/no — like the one
`ADR-0030 §Partial evidence — 2026-08-17` left open: does a pencil-marked RUT
read back cleanly? The first cycle used blue marker on the large fixture, the
RUT columns came back `unreadable`, and the sqlite evidence today (against
the same capture) showed the reader read exactly what was marked. This
fixture isolates the marker-vs-pencil variable in three single-sided sheets.

Three copies, one question each, one page per sheet, single-sided. Takes about
five minutes end to end. The sheet carries a **hand-written `RUT:` line next
to `Nombre:`** — if the bubble grid comes back unreadable, the correct RUT is
still on the sheet and the professor can enter it by hand in the review queue
without asking the student.

> **This repository is public.** The reading report will contain the RUTs you
> mark. Record the **verdict** in `ADR-0030 §Not yet proven` — never the JSON,
> never a photograph of a marked sheet. `tests/work/paper-min/` is gitignored,
> so nothing leaks unless it is pasted somewhere by hand.

## 1. Print

```bash
cd apps/amc-worker
make build       # not optional: paper-min and read-paper-min run the copy of the reader baked into the image
make paper-min   # PAPER_MIN_COPIES=n for a different count
```

That produces `tests/work/paper-min/out/control-min-para-imprimir.pdf` — three
copies, three pages.

**Print single-sided, at 100% scale.** Not "fit to page": AMC finds the sheet
by the four corner marks, and scaling moves them. Use the paper the control
was created for — Letter by default (Chile), A4 if you opened "Opciones
avanzadas" in the create form and switched (ADR-0043 supersedes the
fixed-Letter of ADR-0042). Three sheets come out on that paper.

**A4 leg of this MIN check.** `make paper-min` copies
`tests/fixtures/control-paper-min.tex`, hardcoded to `letterpaper`. To run
the A4 pass, either temporarily flip the class option in that fixture from
`letterpaper` to `a4paper` (then `git checkout` to revert), or drop a
server-generated `paper=a4` source into `tests/work/paper-min/src/` and
run `meptex` on it. Same guidance as PAPER-CHECK.md §1.

## 2. Mark them

**Use pencil (2B or similar). Not marker. Not pen.** That is the variable this
check exists to isolate.

**Fill the `Nombre:` and `RUT:` lines** on each sheet by hand before marking
the RUT grid — the hand-written RUT is your correction against the AMC-read
one, and if the two disagree you already have the right answer without asking
the student.

**Mark inside the boxes** on the RUT grid, one digit per column, no verifier
digit. Marks that spill into adjacent columns are what a marker did on the
first cycle and are the failure mode this check is against.

Three sheets, three variants — pick one RUT per sheet, write it on the
`RUT:` line, then mark it in the grid:

| Sheet | RUT to mark                                            | Q1 answer                                        |
|-------|--------------------------------------------------------|--------------------------------------------------|
|  1    | any 8 digits, all columns filled (clean)                | one option, marked cleanly                        |
|  2    | any 8 digits, but LEAVE ONE COLUMN blank on the grid    | a LIGHT pencil mark — deliberately faint          |
|  3    | any 8 digits, then ERASE one digit and rewrite it       | mark TWO different options on the same question   |

## 3. Scan

- **One PDF for the whole pile.** Not one file per page.
- **300 dpi**, greyscale or colour — both work.
- **Single-sided.** If your scanner defaults to duplex, turn it off —
  otherwise you get three blank back pages that AMC will fail to identify
  and the report says `pages.failed: 3` for no real reason.
- Feed the pile in whatever order — AMC identifies each sheet by its printed
  corner marker.

Save as `apps/amc-worker/tests/work/paper-min/scan/lote.pdf`.

## 4. Read

```bash
cd apps/amc-worker
make read-paper-min
```

Prints the reading report as JSON.

`read-paper-min` wipes the previous run's capture files before running, so a
re-read of the same `lote.pdf` produces the same report as the first read —
without this, `getimages --copy-to` and `analyse --multiple` append to the
existing captures and every digit ends up counted N times (measured on the
first pencil cycle: `pages.captured=18` on a 3-page PDF).

## 5. Compare against the sheet

Five things to check. Fewer than the full paper check, on purpose — this is a
first-cycle question, not a full validation.

1. **Every page captured.** `pages.captured` should be 3 and `pages.failed`
   0. Any copy with `status: incomplete` is a scan-geometry problem, not a
   marking problem.
2. **Sheet 1 RUT: exact digit match.** `copies["1"].rut_status` should be
   `ok` and `copies["1"].rut` should equal the RUT written on that sheet's
   `RUT:` line — digit by digit. This is the check the first pencil cycle
   is here to close.
3. **Sheet 2 RUT unreadable.** `copies["2"].rut_status` should be
   `unreadable`; the missing column should appear in `rut_columns` with
   `digits: []`. The hand-written `RUT:` line on the sheet gives the
   correct value.
4. **Sheet 2 Q1 doubtful.** The light-pencil answer should come back with
   `status: doubtful` (its `darkness` in `[0.05, 0.15)`, the issue #197
   defaults) or `status: blank` (below `0.05`). Either is informative — a
   doubtful means the professor sees it in the review queue; a blank means
   the sensitivity needs lowering. Write the number down.
5. **Sheet 3 Q1 ambiguous.** The double-marked answer should come back with
   `status: ambiguous` and both indices in `marked`. Sheet 3's RUT should
   read the CORRECTED digit (or come back unreadable if the erasure left
   too much graphite in the erased box) — both are acceptable; silently
   reading the ERASED value is not.

## 6. Record

Update `ADR-0030 §Not yet proven` with the outcome. **The verdict, not the
data**: which of the five checks passed, and the darkness number from check
4. Never the JSON, never a photograph — the RUTs are real.

If sheet 1's RUT reads back correctly, that closes the Q2 the first cycle
left open. If it does not, we know the reader has a real limit on paper
RUTs and the fallback (our own PDF plus OMRChecker) has to be reconsidered
— see `ADR-0030 §Review trigger`.

## 7. Iterate

Change one thing, re-print, re-mark, re-scan, re-read. The whole point of the
minimum fixture is that a full cycle is three pages and five minutes.
