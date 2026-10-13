# ADR-0085: The reader tolerates sheets printed to fit the page

**Status:** Accepted. Outstanding: the production regression re-run against
the deployed image on the Jetson (#327 AC-5)
**Date:** 2026-10-13
**Decision-makers:** Miguel Rodriguez
**Source:** #327, from a production incident on control
`5UIUIRM6XZBXHQQ7LWJ7Q7LHIY` (2026-10-13), diagnosed read-only on the Jetson.
Every number below was measured on that box's real scans, or with
`apps/amc-worker/tests/measure-scale.sh`.

## Context

Three copies of a control came back `incomplete`, each missing its second
page. Those pages were in the batch. The professor uploaded the same PDF
again; it was byte-identical, so it gave the same three failures and
re-captured every other page.

AMC finds a page by its four corner circles. `AMC-detect` keeps only the
connected components within a tolerance of the circles' printed diameter
(42.5 px at 300 dpi), and the default tolerance is ±20 %: **34 to 51 px**.
The professor prints with "ajustar a página" (fit to page), because the paper
in the tray decides the size. That is a standing practice, not a mistake.

That control came back at **0.87 linear scale**. The scale is the square root
of the determinant of the transform AMC stores in `capture_page`. The eight
earlier controls with a capture had come back at 0.91–0.94. At 0.87 the
circles measure ~35 px, all four present and clean on every page. On three
pages AMC kept only two of them, fitted the missing corners to the page's own
code boxes (the same size as the circles; MSE ~220 against ≤5 on a good page),
read the page id as `+0/0/0+` and filed the page in `capture_failed` with
"No layout for ID".

The earlier controls had not passed on margin: they sat just above a cliff.

## Decision

**`/analyse` passes `--tol-marque 0.35,0.2` to `auto-multiple-choice
analyse`.** `AMC-analyse.pl` reads it as `<smaller>,<larger>` and hands the
halves to `detect` as `-m` and `-p`. Corner circles from 65 % to 120 % of
their printed size are found. The value is `worker.py` `MARK_TOLERANCE`: one
constant on the one call site, which controls and surveys share. It is not a
request field and not a UI knob, because it calibrates the engine to the
paper, like the 300 dpi `getimages` renders at. The professor never makes it
as a per-batch decision.

**The larger half stays at AMC's default.** Fit-to-page shrinks a Letter sheet
onto Letter or A4 and never enlarges it.

## What this moves, measured

**Real scans, every control on the Jetson**, each re-analysed in a scratch copy
at both tolerances, comparing not only where each page lands but how it is
read. The 305 pages the eight earlier controls had captured land on the same
(copy, page) with **bit-identical transforms** (`a`–`f` and MSE of
`capture_page`), so every box on them reads exactly as before. The incident
control's 31 placed pages land on the same (copy, page) too, but 14 of them
are fitted differently (up to 6.2 px of shift): on a sheet at 0.87 the wider
band finds corners the default missed. Box by box, 2 of its 1,612 boxes change
verdict, both on copy 16 page 2, question 11, from doubtful (darkness 0.088,
identical on both boxes, which reads like a frame fitted onto the printed
border rather than a pencil) to blank; no ticked box changes, so no score
does. Its three missing pages land on (9, 2), (10, 2) and (11, 2) with MSE
≤3.61. The 44 pages of the first control (2026-08-20) that AMC never placed
stay unplaced under both tolerances. The wider band does not start accepting
what it should not.

The placement-only comparison was the first version of this regression; the
#327 review (security lens) showed a synthetic case where the wider band moves
the frame about 18 px while the page still lands right — the copy went to
`needs_review`, not to a wrong grade — and that is why transforms and box
verdicts are compared too.

**Real scans, rescaled** (content shrunk about the centre on the scan's own
canvas; pages placed correctly out of the batch; no page was placed wrongly
at any row):

| Effective scale | Control | default (0.2) | 0.35,0.2 | 0.5,0.2 |
|---|---|---|---|---|
| 0.87 (as scanned) | incident | 31/34 | 34/34 | not run |
| 0.84 | incident · earlier | 0/34 · 0/48 | 34/34 · 48/48 | 34/34 · 48/48 |
| 0.80 | earlier | 0/48 | 48/48 | 48/48 |
| 0.70 | incident | 0/34 | 34/34 | 34/34 |
| 0.65 | incident | 0/34 | 0/34 | 34/34 |

**Synthetic sheets** (`make measure-scale`: the batch is printed at a scale by
ghostscript and rasterised like a scan). The default reads 4/4 at 0.84 and
0/4 at 0.80; `0.35,0.2` reads 4/4 down to 0.70 and 0/4 at 0.65. Synthetic
circles are crisper than toner, so this curve sits lower than paper's.
`tests/09-scaled.sh` asserts it at 0.75, away from both edges.

## Alternatives considered

**Keep AMC's default and require printing at 100 %.** `PAPER-CHECK.md` said
exactly that until now. Rejected: the professor prints to fit, and a rule
that has to be remembered at the printer is how this incident happened. The
cost of being wrong is a control nobody notices is half-read until a student
asks.

**`0.5,0.2`.** Reads one step further (0.65), and was measured to place no page
wrongly. Rejected for now: the lowest real control measured is 0.87, and
0.70 already leaves 0.17 below it. A
wider lower bound only adds components that compete for a corner: filled
answer boxes, handwriting, the page's own code boxes, which already compete at
the default. Revisit if a real control ever comes back near 0.70.

**Retry only the unplaced pages at a wider tolerance.** It reaches the same
result with a second code path and runs AMC twice on exactly the batches that
already failed. Rejected.

**Detect the scale and resize each scan before AMC sees it.** It reimplements
AMC's own corner detection to undo what AMC's tolerance already handles.
Rejected.

## Consequences

- **"Fit to page" is supported.** `PAPER-CHECK.md` and `PAPER-CHECK-MIN.md`
  say so, with the measured margin: every page read at 0.70, none at 0.65.
- **The trap is a test.** `tests/09-scaled.sh` reads a batch printed at 0.75
  through bare AMC, where the default places nothing, and then through the
  worker, which places every page. An AMC upgrade that moves the default turns
  the first half red. `tests/measure-scale.sh` (`make measure-scale`) reports
  the whole curve for both tolerances, so the margin is re-measured rather
  than assumed.
- **The synthetic checks bound the value from below only.** A much wider
  tolerance (`0.9,0.9`, marks from 4 to 81 px) keeps every script green
  (#327 review): synthetic sheets have nothing for an extra component to
  compete with. The harm a wider band can do shows only on real scans.
- **What the tolerance cannot fix.** A sheet enlarged past the paper, a corner
  cut by the scanner, or a page from another Nalanda control: every control
  prints the same markers (ADR-0075 §Consequences), and AMC will place such a
  page as this control's.
- **Re-uploading the same PDF is never a repair.** The result is
  deterministic, and since ADR-0075 a re-capture clears the copy's
  corrections. The worker's job banner already says how many pages it could
  not recognise.

## Review triggers

- A page placed on the wrong copy or page anywhere in production. Every
  measurement so far placed none wrongly; the first one reopens the value.
- A real control whose capture determinant (`a·d − b·c`) falls below 0.56,
  which is a 0.75 linear scale: closer to the measured margin than any
  control seen so far (the lowest was 0.87).
- An AMC upgrade: re-run `make measure-scale` and `tests/09-scaled.sh` before
  trusting the curve.
- Widening either half of the tolerance: re-run the #327 production
  regression on real scans — every control's scans re-analysed in scratch
  copies at the old and the new value, comparing transforms and box verdicts,
  not only placement. `make measure-scale` and `09-scaled.sh` alone cannot
  reject a value that is too wide.
- A captured page whose MSE is far above what good pages show (≤5 on every
  real page measured for #327): the frame was fitted to something other than
  the four circles.

## References

- #327: the incident, the diagnostic recipe, every measurement table.
- ADR-0030 §Not yet proven ("corner marks not found" as a review trigger):
  amended by this ADR.
- ADR-0075: single-mode capture, and what a re-capture clears.
- `apps/amc-worker/worker.py` `MARK_TOLERANCE`; `AMC-analyse.pl:78,181–187`
  in the AMC 1.6.0 image.
