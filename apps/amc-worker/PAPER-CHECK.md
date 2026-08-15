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

## 1. Print

`tests/work/paper/out/control-para-imprimir.pdf` — six copies, twelve pages.

- **Print double-sided (dúplex), at 100% scale.** Not "fit to page": AMC finds
  the sheet by the four corner marks, and scaling moves them. If your dialog
  offers "actual size" or "100%", that is the one.
- Plain white A4. Six sheets come out.

Regenerate it any time with:

```bash
make build   # if you have not already
docker run --rm --env DISPLAY= -v "$PWD/tests/work/paper:/work" -w /work \
  nalanda/amc-worker:dev auto-multiple-choice prepare \
  --mode s --n-copies 6 --with pdflatex \
  --data /work/project/data --prefix /work/project \
  --out-sujet /work/out/control-para-imprimir.pdf \
  --out-calage /work/out/calage.xy /work/src/control-demo.tex
```

## 2. Mark them like a student would

Use a pencil, not a pen, and do **not** be neat. The point is to find where the
reader gives up, so the batch should contain the things a real pile contains.
Suggested spread over the six sheets — write down what you did on each, you will
need it in step 4:

| Sheet | RUT | Answers |
|---|---|---|
| 1 | your own, filled cleanly | one per question, filled solidly |
| 2 | someone else's, filled cleanly | one per question, marked lightly — a faint pencil |
| 3 | filled cleanly | one question **left blank** |
| 4 | filled cleanly | one question with **two boxes** marked |
| 5 | one column **left blank** | one per question |
| 6 | filled, then **one digit erased and corrected** | one answer erased and corrected |

Sheets 5 and 6 are the ones that matter most: they are the manual review queue's
whole reason to exist, and an erased-and-corrected mark is the case a synthetic
fill can never produce.

Mark **crosses or full fills inside the boxes**, not ticks spilling outside them.
That is what the sheet asks students for and what the reader measures.

## 3. Scan

- **One PDF for the whole pile**, not one file per page.
- **300 dpi**, greyscale or colour — both work; pure black-and-white line art
  can lose a faint pencil.
- **Duplex**, so the back of every sheet is in the file. Each copy is two pages
  and AMC expects both.
- Feed the pile **in whatever order it came off the printer**, or deliberately
  shuffled. Order does not matter — AMC identifies each page by the marker
  printed on it — and shuffling is a free extra check.

Save it as `apps/amc-worker/tests/work/paper/scan/lote.pdf`.

## 4. Read it

```bash
cd apps/amc-worker
mkdir -p tests/work/paper/scan tests/work/paper/project/cr tests/work/paper/project/scans
cp *.py tests/work/paper/

docker run --rm --env DISPLAY= -v "$PWD/tests/work/paper:/work" -w /work \
  nalanda/amc-worker:dev bash -c '
    D=/work/project/data
    auto-multiple-choice getimages --list /work/project/scans/list.txt \
      --vector-density 300 --copy-to /work/project/scans /work/scan/lote.pdf
    auto-multiple-choice analyse --data $D --projet /work/project \
      --cr /work/project/cr --multiple --liste-fichiers /work/project/scans/list.txt
    python3 /work/read_capture.py --data $D
  '
```

The last command prints the reading report as JSON.

## 5. What to look for

Compare the report against what you actually marked. Five questions, in order of
how badly a "no" would hurt:

1. **Was every page captured?** `pages.captured` should be 12 and
   `pages.failed` 0. A page AMC could not find the corner marks on is the worst
   outcome — it means the print or the scan geometry is wrong, and nothing
   downstream can recover it.
2. **Did every RUT read back correctly?** Sheet by sheet, against what you
   wrote. A wrong digit is worse than an unread one.
3. **Did the deliberate damage land in the right bucket?** Sheet 3's blank
   answer should be `blank`, sheet 4's double mark `ambiguous`, sheet 5's blank
   column `rut_status: unreadable`. If any of those reads as a confident
   single answer instead, the threshold is wrong.
4. **Did the faint pencil on sheet 2 read at all?** If it did not, raise
   `--ticked` sensitivity (`read_capture.py --ticked 0.20`) and re-run — the
   report is regenerated from the same capture, no re-scan needed.
5. **Did the corrected mark on sheet 6 read as the corrected value**, or as
   both? Either is acceptable — reported as ambiguous is a correct answer to a
   genuinely ambiguous sheet — but silently reading the *erased* value is not.

## 6. Record the result

Whatever happens, it goes in **ADR-0030 §Not yet proven**, which is written to
be edited by this outcome. If it passes, that section says so and the ADR is
final. If something fails, name which of the five above broke: that is what
tells WP-E and WP-F whether they are building on AMC or on the fallback (our own
PDF generation plus OMRChecker), and the container boundary is what makes that a
swap rather than a rewrite.
