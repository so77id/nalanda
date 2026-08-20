# The paper check

The one verification in #138 that no agent can run, and the one that decides
whether Auto-Multiple-Choice is the engine.

Every batch the automated suite reads was **filled synthetically** — boxes
blackened at the exact coordinates AMC's own layout database reports. That
proves the whole pipeline hangs together and says nothing about paper. A real
mark is off-centre, grey, made with whatever pencil the student had, and
sometimes half-erased. A real page goes into the feeder rotated a degree or two.
A real scanner has its own contrast curve. None of that exists in a synthetic
fill, which is why the measured timings are a **lower bound** rather than an
estimate, and why a green suite is not evidence that this works.

Takes about fifteen minutes.

> **This repository is public.** The reading report in step 4 contains real
> RUTs. Record the **verdict** in ADR-0030 — which of the five questions in
> step 5 passed — never the JSON, never a photograph of a marked sheet. A
> national ID in public git history cannot be taken back. `tests/work/` is
> gitignored, so nothing leaks unless it is pasted somewhere by hand.

## 1. Print

```bash
cd apps/amc-worker
make build      # not optional: steps 1 and 4 run the code baked into the image
make paper
```

**`make build` first.** Both `make paper` and `make read-paper` invoke the copy
of the reader that the image carries, not the one in your working tree. Against
a stale image the failure lands at **step 4** — after you have printed, marked
six sheets by hand and scanned them.

That produces `tests/work/paper/out/control-para-imprimir.pdf` — six copies,
twelve pages — and loads the layout AMC will read by. `make paper PAPER_COPIES=n`
for a different count.

The setup is a target rather than a list of commands because the first version
of this document told you to run `prepare` against a source directory nothing
created, and never ran `meptex` at all. Both were found in review (#138, F-8).
The second one is the dangerous half: without `meptex` the layout is empty, so
you would print, mark, scan, and step 4 would read nothing and tell you AMC had
failed.

**Print double-sided (dúplex), at 100% scale.** Not "fit to page": AMC finds
the sheet by the four corner marks, and scaling moves them. If your dialog
offers "actual size" or "100%", that is the one. Plain white US Letter; six
sheets come out (paper size is a printer-facing contract per ADR-0042).

## 2. Mark them like a student would

Use a pencil, not a pen, and do **not** be neat. The point is to find where the
reader gives up, so the batch should contain the things a real pile contains.
Write down what you did on each sheet — you need it in step 5.

| Sheet | RUT | Answers |
|---|---|---|
| 1 | your own, filled cleanly | one per question, filled solidly |
| 2 | someone else's, filled cleanly | one per question, marked **lightly** — a faint pencil |
| 3 | filled cleanly | one question **left blank** |
| 4 | filled cleanly | one question with **two boxes** marked — on a question labelled *(una respuesta)* |
| 5 | one column **left blank** | one per question |
| 6 | filled, then **one digit erased and corrected** | one answer erased and corrected |

Sheets 5 and 6 are the ones that matter most: they are the manual review
queue's whole reason to exist, and an erased-and-corrected mark is the case a
synthetic fill can never produce. Sheet 2 matters for a different reason — the
faint pencil lands in the band between the two thresholds, which is where the
reader had a bug that reported it as a confident answer (#138, F-2).

Mark **crosses or full fills inside the boxes**, not ticks spilling outside
them — that is what the reader measures. The printed sheet does not say so: its
header block covers the instructions and the score, and if the paper check
shows students spilling outside the boxes, the fix is a line there, in the
source, not in the reader.

**Sheet 4's double mark has to go on a question the sheet labels *(una
respuesta)*.** Every question states its type in words, and on one labelled
*(varias respuestas)* two boxes are simply the right answer — the report would
say `ok`, correctly, and you would record a failure of the engine that never
happened.

## 2b. Judge the sheet at the resolution it is read at

If you render a page to look at it rather than printing it, render it at the
**scanner's resolution — 300 dpi** (220 was enough to settle the case below).

At 100 dpi the rendering **invents defects**. Adjacent `[` `]` blurred into what
looked like a missing-glyph box and `int[]` was reported as broken typesetting
that did not exist; at 220 dpi the same page was clean. The repo's rule is that
the evidence is the pixels, and this is its rider: the pixels have to be at the
resolution the thing is actually read at, or you are inspecting the renderer.

```bash
docker run --rm --env DISPLAY= -v "$PWD/tests/work/paper:/work" \
  nalanda/amc-worker:dev \
  pdftoppm -r 300 -f 1 -l 1 -singlefile -png /work/out/control-para-imprimir.pdf /work/out/pagina1
```

## 3. Scan

- **One PDF for the whole pile**, not one file per page.
- **300 dpi**, greyscale or colour — both work; pure black-and-white line art
  can lose a faint pencil, which would make sheet 2 prove nothing.
- **Duplex**, so the back of every sheet is in the file. Each copy is two pages
  and AMC expects both.
- Feed the pile **in whatever order it came off the printer**, or deliberately
  shuffled. Order does not matter — AMC identifies each page by the marker
  printed on it — and shuffling is a free extra check.

Save it as `apps/amc-worker/tests/work/paper/scan/lote.pdf`.

## 4. Read it

```bash
cd apps/amc-worker
make read-paper
```

It prints the reading report as JSON.

To retry with a different sensitivity — see question 4 below — the report is
regenerated from the same capture, so no re-scan is needed:

```bash
docker run --rm --env DISPLAY= -v "$PWD/tests/work/paper:/work" \
  nalanda/amc-worker:dev \
  python3 /opt/amc-worker/read_capture.py --data /work/project/data \
    --ticked 0.20 --unsure 0.05
```

Both flags matter and they move different boundaries: `--ticked` is where a mark
becomes a confident answer, `--unsure` is where it stops being noticed at all. A
mark that came back `blank` fell below `--unsure`, and lowering `--ticked` alone
cannot rescue it.

**A CLI re-read at another `--ticked` comes back with `scoring.stale: true`**,
and that is the report telling the truth rather than a fault: the marks moved
and the per-question scores did not, because this script scores at its own
threshold during `make read-paper`. The marks are what this step calibrates,
so read them; the scores in a stale report belong to the previous threshold
and are evidence of nothing before the batch is scored again. (The SERVER's
re-read does not have this caveat: since issue #197 `POST /reanalyse` re-runs
`note` at the new threshold, so marks and scores move together.)

## 5. What to look for

Compare the report against what you actually marked. Five questions, in order
of how badly a "no" would hurt:

1. **Was every page captured?** `pages.captured` should be 12 and
   `pages.failed` 0, and no copy should have `status: "incomplete"`. A page
   whose corner marks AMC could not find is the worst outcome — it means the
   print or the scan geometry is wrong, and nothing downstream can recover it.
2. **Did every RUT read back correctly?** Sheet by sheet, against what you
   wrote. A wrong digit is worse than an unread one.
3. **Did the deliberate damage land in the right bucket?** Sheet 3's blank
   answer should be `blank`, sheet 4's double mark `ambiguous` — **provided you
   made it on a question labelled *(una respuesta)***; on a *(varias
   respuestas)* one, `ok` is the correct answer and the check proves nothing —
   and sheet 5's blank column `rut_status: "unreadable"`. If any reads as a
   confident single answer instead, the threshold is wrong.
4. **How did the faint pencil on sheet 2 read?** `doubtful` is the right answer
   — the report should carry it under `doubtful` with its measured `darkness`,
   not under `marked`. If it came back `blank`, the mark was below `unsure`
   (0.05, the issue #197 default) and the sensitivity needs lowering; if it
   came back a confident `marked`, it was above `ticked` (0.15) and your
   "faint" was not faint. Both
   are useful measurements of where a real pencil actually lands — write the
   number down. The two flags move different boundaries; see §4.
5. **Did the corrected mark on sheet 6 read as the corrected value**, or as
   both? Either is acceptable — reported as ambiguous is a correct answer to a
   genuinely ambiguous sheet — but silently reading the *erased* value is not.

## 6. Record the result

Whatever happens, it goes in **ADR-0030 §Not yet proven**, which is written to
be edited by this outcome. The verdict, not the data: which of the five
questions passed, and the darkness number from question 4.

If it passes, that section says so and the ADR is final. If something fails,
name which of the five broke: that is what tells WP-E and WP-F whether they are
building on AMC or on the fallback (our own PDF generation plus OMRChecker),
and the container boundary is what makes that a swap rather than a rewrite.
