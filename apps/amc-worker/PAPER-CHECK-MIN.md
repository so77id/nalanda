# The minimum paper check

The version of `PAPER-CHECK.md` for iterating on ONE variable at a time.

**Origin.** The full paper check burns six sheets × two pages per cycle, which is
too much paper when the question under test is a single yes/no — like the one
`ADR-0030 §Partial evidence — 2026-08-17` left open: does a pencil-marked RUT
read back cleanly? Yesterday's cycle used blue marker on one large fixture, the
RUT columns came back `unreadable`, and the sqlite evidence today (against the
same capture) showed the reader read exactly what was marked. The engine is
almost certainly fine; the marker-vs-pencil variable is what needs isolating.

Three copies, one question each, one page per sheet, single-sided. Takes about
five minutes.

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
by the four corner marks, and scaling moves them. Plain white A4; three sheets
come out.

## 2. Write the reference paper first (do this BEFORE marking anything)

The one lesson from yesterday's cycle: **write down what you plan to mark
before you mark it**, so the comparison at step 4 is against the paper you
wrote and not against a guess about what you probably marked.

Take a scratch sheet and copy this table. Fill in the RUTs and answers.

| Sheet | RUT (write the 8 digits, 1..8 left-to-right)             | Q1 answer (letter or "blank" / "light" / "double") |
|-------|----------------------------------------------------------|----------------------------------------------------|
|  1    | ______________ (choose one — yours, or `12345678`)        | one letter, marked cleanly                          |
|  2    | ______________ (choose one, then LEAVE ONE COLUMN blank) | LIGHT pencil — barely visible                        |
|  3    | ______________ (choose one, ERASE one digit and rewrite) | DOUBLE MARK — mark two letters                       |

The reference paper stays out of the pile.

## 3. Mark the printed sheets

**Use pencil (2B or similar). Not marker. Not pen.** That is the variable this
check exists to isolate.

**Mark inside the boxes**, not spilling out. On the RUT grid the box is small
(~5mm), and a stroke that crosses into the next column's vertical space is
what a marker did yesterday.

Follow your reference paper for each sheet:

- **Sheet 1** — clean RUT (all 8 columns, one digit each), Q1 clean single
  mark.
- **Sheet 2** — RUT with ONE COLUMN LEFT BLANK; Q1 with a LIGHT pencil mark
  (a faint stroke, deliberately not solid).
- **Sheet 3** — RUT with one digit ERASED AND REWRITTEN in the SAME column
  (so the column ends up with one clear mark plus erasure smudge); Q1 with
  TWO different letters marked (a real DOUBLE mark on a `una respuesta`
  question).

## 4. Scan

- **One PDF for the whole pile.** Not one file per page.
- **300 dpi**, greyscale or colour — both work.
- **Single-sided**, one page per sheet. If your scanner defaults to duplex,
  turn it off for this batch — otherwise you get three extra blank pages that
  AMC will fail to identify and the report says `pages.failed: 3` for no real
  reason.
- Feed the pile in whatever order — AMC identifies each sheet by its printed
  corner marker.

Save as `apps/amc-worker/tests/work/paper-min/scan/lote.pdf`.

## 5. Read

```bash
cd apps/amc-worker
make read-paper-min
```

Prints the reading report as JSON.

## 6. Compare against the reference paper

Five things to check. Fewer than the full paper check, on purpose — this is a
first-cycle question, not a full validation.

1. **Every page captured.** `pages.captured` should be 3 and `pages.failed`
   0. Any copy with `status: incomplete` is a scan-geometry problem, not a
   marking problem.
2. **Sheet 1 RUT: exact digit match.** `copies["1"].rut_status` should be
   `ok` and `copies["1"].rut` should equal what you wrote for sheet 1 on the
   reference paper — **digit by digit**. This is the check yesterday's cycle
   left open.
3. **Sheet 2 RUT unreadable.** `copies["2"].rut_status` should be
   `unreadable`; the missing column should appear in `rut_columns` with
   `digits: []`.
4. **Sheet 2 Q1 doubtful.** The light-pencil answer should come back with
   `status: doubtful` (its `darkness` in the range `[0.10, 0.30)`) or with
   `status: blank` (below 0.10). Either is informative — a doubtful means the
   professor sees it in the review queue; a blank means the sensitivity needs
   lowering. Write the number down.
5. **Sheet 3 Q1 ambiguous.** The double-marked answer should come back with
   `status: ambiguous` and both indices in `marked`. Sheet 3's RUT should read
   the CORRECTED digit (or come back unreadable if the erasure left too much
   graphite in the erased box) — both are acceptable outcomes; silently
   reading the ERASED value is not.

## 7. Record

Update `ADR-0030 §Partial evidence — 2026-08-17` with the outcome. **The
verdict, not the data**: which of the five checks passed, and the darkness
number from check 4.

If sheet 1's RUT reads back correctly, that closes the outstanding Q2 from
yesterday's cycle. If it does not, we know the reader has a real limit on
paper RUTs and the fallback (our own PDF plus OMRChecker) has to be
reconsidered — see `ADR-0030 §Review trigger`.

## 8. Iterate

Change one thing, re-print, re-mark, re-scan, re-read. The whole point of the
minimum fixture is that a full cycle is three pages and five minutes.
