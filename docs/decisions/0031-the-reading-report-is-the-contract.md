# ADR-0031: The reading report is the contract, and it outlives the engine

**Status:** Accepted
**Date:** 2026-08-15
**Decision-makers:** Miguel Rodriguez
**Source:** #138 review (round B) — split out of ADR-0030
**Amended by:** #147 (2026-08-16) — multiple-answer questions, per-question
weight, and the threshold the scores were computed at
**Amended by:** #229 (2026-08-26) — per-copy printed order of questions and
alternatives

## Context

`apps/amc-worker` returns a JSON report describing what it read off a batch of
scanned control sheets. WP-F (the manual review queue) and WP-G (publishing
grades) will be specified entirely against that shape, and `apps/server`'s data
model joins to it: the design's `control_pregunta.pregunta_ref`
(`docs/design/2026-08-controles.md`) is the question identifier this report
returns.

It was first recorded as a consequence of ADR-0030 — the choice of
Auto-Multiple-Choice as the engine. That is the wrong home, and the test is the
reversal: **if the paper check disqualifies AMC and the fallback is taken (our
own PDF generation plus OMRChecker), this report keeps exactly the same shape.**
A decision that survives the reversal of the ADR it is filed under is filed
under the wrong ADR.

**Three fields added in 2026-08 do not survive that reversal, and the test is
narrower because of them** (#147). `scoring.seuil` is named after the engine's
own flag and means "the threshold its separate scoring pass used"; `stale` is
meaningful only because that pass exists and can disagree with our reading; and
the precondition that such a pass must have run is unsatisfiable for an engine
that scores in process. Under the fallback the reader would own both thresholds,
they would be equal by construction, and `stale` could never be true. Everything
else here — the three failure kinds, the three darkness verdicts, `type`,
`score`, `max`, and the normalisation that divides by `max` — is engine-independent
and is what the reversal test still protects. ADR-0030 §Not yet proven carries a live trigger to reopen
the engine choice; nothing in it should be read as reopening this.

## Decision

**The reading report is the contract between the worker and everything above
it, and it is engine-independent.** Its shape is owned here.

### Three failure kinds, never merged

They are kept apart because they need **different repairs**, and a copy can have
one without the others:

| Kind | Field | Repair |
| --- | --- | --- |
| *Who is this* | `rut_status: "unreadable"` | type eight digits into the queue |
| *What did they mark* | answer `status`: `blank` / `ambiguous` / `doubtful` | a human looks at the sheet |
| *What is missing* | copy `status: "incomplete"` | find the sheet and scan it again |
| *What cannot be scored* | no report at all — exit 2, the reason on stderr | re-run the engine's scoring pass after the last capture |

The third is the one that cannot be repaired at a keyboard, which is why it is
its own status rather than another flavour of "needs review". It is detected by
comparing the questions captured against the questions the layout says the copy
**printed** — without that comparison a sheet whose page never reached the
scanner (a double feed, the likeliest failure with real paper) reports clean and
a student gets zero on half the exam with nothing to show for it.

### A question says which kind it is, and several marks are an answer

A question that admits **several correct alternatives** carries
`type: "multiple"`; one that admits a single alternative carries
`type: "simple"`. The distinction cannot be recovered from the capture — a box
is a box — so it comes from the engine's own scoring data, and it is the reason
the reader now needs a third database (below).

**On a multiple question, several marks are the ANSWER and nothing is flagged.**
Only a simple question with more than one mark is `ambiguous`. The reader used
to call every second mark an ambiguity, which sent a student who had answered
correctly to the manual review queue and told the professor to go and inspect a
sheet that was right.

The engine's own "none of these" mechanism (AMC's `completemulti`) is **off**,
and that is part of this contract rather than a fixture detail. It appended an
extra box to every multiple question, all-or-nothing, and numbered that
question's alternatives from **0** while simple questions started at 1. Measured,
the authored alternatives keep `1…N` either way and only the appended box takes
index 0 — so a reader assuming 1-based did not mis-map anything, it silently
**dropped** a box that can be ticked and scored. With the option off, both types number `1…N` (measured), and a
question that wants that alternative carries it as an ordinary authored choice,
pinned last so its wording stays true wherever the shuffle puts the rest.

### Every question weighs one point, and the caller does the arithmetic

The engine weighs a simple question 1 and a multiple **one point per
alternative**, so one multiple would outweigh three simple questions — and
since every copy draws its own questions, the same mistake would cost different
students different amounts. The course's rule is that **every question weighs
one point** (`docs/design/2026-08-controles.md` §C16).

The report therefore carries the engine's own per-question `score` and `max`,
and the caller normalises:

```
relative_i = score_i ÷ max_i          the fraction of question i's single point
grade      = Σ relative_i             over the N questions THIS copy drew
percentage = grade ÷ N                out of N, because each question is one point
```

`max_i` is **not a constant** — 1 for a simple question, the alternative count
for a multiple — which is why it travels with each answer rather than being
assumed by the caller. Turning a percentage into a 1,0–7,0 mark is
`apps/server`'s, not this contract's.

**The configuration in force is the engine's DEFAULT per-box scoring, adopted by
omission** — the source sets no scoring directive — and what it awards was
measured on a four-alternative question with two correct alternatives
(2026-08-16):

| What the student did | `score` / `max` | `relative` |
|---|---|---|
| ticked both correct | 4 / 4 | 1.00 |
| ticked one correct, nothing wrong | 3 / 4 | 0.75 |
| ticked only a wrong one | 1 / 4 | 0.25 |
| **ticked every box** | **2 / 4** | 0.50 |
| left it blank | 0 / 4 | 0.00 |

Two cases in that table are worth stating rather than leaving to be
rediscovered. A wholly wrong answer on a multiple keeps a quarter of the point,
because the boxes left alone were left alone correctly — which is the design's
own rule that nothing is ever subtracted (§C7), not an accident. And **ticking
every box lands on 0.50, which is exactly where §C7 puts the 4,0** — so on that
question marking everything does not win, but it draws with the pass line.
Neither is a defect; both are consequences of per-box scoring, and a course that
wants otherwise is changing §C7 rather than this report.

Bending the engine's own scoring formula was tried and rejected: measured, its
all-or-nothing setting fails a student who got half a question right, and its
partial-credit setting awards **full marks for ticking every box** — the hole
this design exists to close. Reporting the engine's numbers and owning the
arithmetic keeps the decision ours and survives an engine swap, which is the
whole point of this ADR.

### Each answer says where it printed on THIS copy, and in what order

The engine shuffles both the questions per copy (a random draw plus
`\shufflegroup`) and the alternatives per question. A reader that iterated
by numeric question id and by authoring alternative index produced a review
page whose questions and options were rendered in a different order than
the paper the professor held (#229): nothing was mismarked, but the mental
alignment broke.

So each answer carries `position` (its 1-based slot on THIS copy's printed
sheet) and `alternatives` (the authoring-index list in printed order for
THIS copy, per question). The natural key for the reader is still the
authoring alternative index — it is what `marked` names, what the review
form posts back, and what the bank's Correct list is keyed by — so
`alternatives` is a permutation OF those indices, not a replacement for
them. `position` and `alternatives` are engine-independent by
construction: any engine that can print a shuffled paper knows this order
and can publish it; the AMC-fallback reversal test still holds.

Both fields are **optional**. A missing `position` (0) and an empty
`alternatives` mean "the analyzer has no layout data" — a reading written
before this amendment, or an analyzer that predates it. Callers rendering
the paper fall back to their pre-amendment ordering (iteration order for
the outer answers list, bank order for the alternatives) rather than
refusing the report, so historical readings stay legible.

### The report says which threshold its scores were computed at

Scoring runs at the engine's own threshold, while `ticked` is ours and
**tunable per batch** — and the two are independent knobs on the same capture.
Re-reading a stored capture at a different sensitivity moves the marks and
leaves the scores where they were, so the report would disagree with the grade
in silence. That is the same defect as the one below, one level up.

So the report carries `scoring: {seuil, ticked, stale}`: what the engine scored
at, what this reading used, and `stale: true` when they differ. The caller can
then re-score, or say so, but it cannot be misled.

### Three darkness verdicts, not two

The engine reports how dark each box is; deciding what that *means* is ours.

- at or above `ticked` (0.30) → **marked**
- at or above `unsure` (0.10) → **doubtful**, reported with its measured
  darkness and never counted as an answer
- below → **blank**

Both thresholds are tunable per batch, and the report is regenerated from a
stored capture, so a professor can re-read a scanned pile at a different
sensitivity without re-scanning it.

The middle band is where a half-erased pencil lands, and it is load-bearing. It
was first written with no effect — both branches of its `if/elif` appended to
the same list — so a mark at 0.15 was reported as a confident answer while the
engine's own scoring treated it as blank: the report and the grade disagreed,
silently, in the exact case `PAPER-CHECK.md` asks the professor to create on
purpose.

## Alternatives considered

- **Two failure kinds, folding `incomplete` into `needs_review`.** What the
  design doc originally described. Rejected because it conflates a repair the
  professor can do at a keyboard with one that requires finding a sheet — and
  because "needs review" on a copy whose page was never scanned tells the
  reviewer nothing about what to review.
- **Letting the engine do the normalisation**, by configuring its scoring
  formula so every question came back out of 1. Measured on both obvious
  settings and rejected: one is all-or-nothing, the other gives full marks for
  ticking every box. It also puts a decision of ours inside a scoring language
  whose documentation is not even in the image, to be re-verified on every
  engine upgrade.
- **Keeping the engine's appended "none of these" box.** It comes with wrong
  Spanish we cannot correct per question, cannot be aimed at the questions that
  want it, and drags 0-based numbering into one question type and not the
  other. An authored alternative costs one line and behaves like every other.
- **Publishing an unscored question as `score: null` under `status: "ok"`, or
  queuing it for human review.** What the code did before it was measured. The
  first is the silent-wrong report this ADR exists to prevent; the second sends
  a human to look at a sheet that is perfectly legible, when the repair is
  re-running the scoring pass. A failure whose repair is not "a human looks at
  the sheet" does not belong in the review queue — that is what §Three failure
  kinds is for.
- **Two darkness verdicts (marked / blank).** Simpler, and what the code did
  before the review caught it. Rejected: it silently disagrees with the scoring,
  and it throws away the one measurement that tells a professor whether their
  threshold matches the pencils their students actually use.
- **Returning the engine's own export format.** Rejected: it would make the
  report an engine detail, which is precisely what this ADR exists to prevent.

## Consequences

- **`docs/design/2026-08-controles.md` §lectura.estado gains a third value.**
  It was written with two; the third was found by exercising a lost page.
- **WP-F and WP-G bind here, not to ADR-0030.** Reopening the engine choice does
  not reopen this contract.
- **The thresholds are a caller-facing tunable**, so `apps/server` must carry
  them through rather than hard-coding them, and `PAPER-CHECK.md` question 4 is
  the procedure that calibrates them against real pencils.
- **The reader needs the batch to have been SCORED, not only captured.** Three
  databases, not two: what was printed, what was read off the paper, and what
  each question is and was worth. The third only exists after the engine's
  scoring pass has run, and a project without it is **refused loudly** rather
  than reported with the fields quietly absent — measured, the half-done state
  is the dangerous one, because the scoring tables exist and are empty, which
  reads exactly like a batch where nobody scored a point. Every caller that
  drives the CLI by hand must run that pass; `/analyse` already does.

  **The CHECK is per question — a batch whose scoring tables are merely
  non-empty is not enough — and one unscored question refuses the WHOLE report**,
  because a partial report is exactly the silent disagreement this contract
  exists to forbid. The half-scored state is reachable and was reached: the engine scores the copies the SOURCE declares
  and not the ones that were printed, so a class larger than that default yields
  copies that are captured and never scored. Measured on the paper check as
  shipped: one copy came back with every score null under `status: "ok"`, absent
  from the review queue, exit 0 — a well-formed report about a real sheet a real
  student filled in. A score that is absent is never published as a score, and
  it is not a review-queue entry either: the repair is re-scoring, not a human
  looking at the sheet, and mixing the two is what §Three failure kinds exists
  to prevent.
- **We depend on the engine's private storage, not only its CLI.** The current
  reader opens AMC's `layout.sqlite`, `capture.sqlite` and `scoring.sqlite`
  directly and knows facts like `capture_zone.type = 4` and
  `scoring_question.type = 2` for a multiple-answer question. That coupling is deliberately confined to
  `read_capture.py` inside the worker image, which is what keeps an engine swap
  a container swap. `tests/01-headless.sh` pins the AMC version, so an upgrade
  reddens CI — treat that assertion as a **schema tripwire**, not a version
  note, and review the reader before bumping it.

## References

- ADR-0030 — the engine, the container boundary, and the traps it neutralises.
- ADR-0033 — the printed sheet, which is the other half of this contract: what
  the student is handed, and what comes back from it.
- `docs/design/2026-08-controles.md` — §lectura.estado and the data model this
  report joins to.
- `apps/amc-worker/read_capture.py` — the implementation; its module docstring
  is the field-by-field schema.
- `apps/amc-worker/PAPER-CHECK.md` — the procedure that calibrates the
  thresholds against paper.
