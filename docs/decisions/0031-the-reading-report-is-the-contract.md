# ADR-0031: The reading report is the contract, and it outlives the engine

**Status:** Accepted
**Date:** 2026-08-15
**Decision-makers:** Miguel Rodriguez
**Source:** #138 review (round B) — split out of ADR-0030

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
under the wrong ADR. ADR-0030 §Not yet proven carries a live trigger to reopen
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

The third is the one that cannot be repaired at a keyboard, which is why it is
its own status rather than another flavour of "needs review". It is detected by
comparing the questions captured against the questions the layout says the copy
**printed** — without that comparison a sheet whose page never reached the
scanner (a double feed, the likeliest failure with real paper) reports clean and
a student gets zero on half the exam with nothing to show for it.

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
- **We depend on the engine's private storage, not only its CLI.** The current
  reader opens AMC's `layout.sqlite` and `capture.sqlite` directly and knows
  facts like `capture_zone.type = 4`. That coupling is deliberately confined to
  `read_capture.py` inside the worker image, which is what keeps an engine swap
  a container swap. `tests/01-headless.sh` pins the AMC version, so an upgrade
  reddens CI — treat that assertion as a **schema tripwire**, not a version
  note, and review the reader before bumping it.

## References

- ADR-0030 — the engine, the container boundary, and the traps it neutralises.
- `docs/design/2026-08-controles.md` — §lectura.estado and the data model this
  report joins to.
- `apps/amc-worker/read_capture.py` — the implementation; its module docstring
  is the field-by-field schema.
- `apps/amc-worker/PAPER-CHECK.md` — the procedure that calibrates the
  thresholds against paper.
