# ADR-0041: One darkness-threshold pair per control, defaulted to read X marks

**Status:** Accepted
**Date:** 2026-08-19
**Decision-makers:** Miguel Rodriguez
**Source:** #197, measured on the first real batch read in the Jetson
(Control 0, 30 copies, 2026-08-19).

## Context

The darkness thresholds existed on only one side of the pipeline: the
reader decided "marked or not" with a configurable `ticked/unsure`, while
AMC's `note` and the annotated-PDF drawing ran at a hardcoded 0.30. Two
failures followed, both seen in production:

- **X marks did not read.** Measured on the real batch: pencil X marks land
  at 0.14-0.32 darkness, painted squares at 0.62-1.00, empty boxes at ~0.0.
  The 0.30 default cut through the middle of the X band.
- **Recalibrating did not recalibrate.** Re-reading at new thresholds moved
  the marks and left the scores where `note` had put them (`scoring.stale`),
  and #190's reanalyse even dropped the annotated PDFs without regenerating
  them.

## Decision

- **One pair per control, last-wins.** `control.ticked/unsure` (migration
  `00008`), chosen at upload, re-chosen at reanalyse, persisted, and used
  by the worker for the reader, `note` AND the annotated PDF — one number,
  three consumers. The server flow can no longer produce `scoring.stale`.
- **Defaults 0.15/0.05.** Chosen from the measured X band: 0.15 accepts
  every X except the faintest tail, which falls into the doubtful band
  (0.05-0.15) and stays visible in `needs_review` instead of being lost.
  Empty boxes (~0.0) stay far below.
- **Reanalyse re-scores and re-annotates.** The re-read re-runs `note` at
  the new threshold and re-runs ruta A over the copies the new reading
  accepts, so corrected PDFs reappear without saving copy by copy.

## Alternatives considered

- **A global constant the operator edits** — one number for the whole
  server, no UI. Rejected: darkness depends on the batch (pencil, scanner),
  and the professor is the one who sees the sheets.
- **Thresholds per answer/copy** — rejected: the failure mode is
  batch-wide (same pencil, same scanner), and finer granularity is a
  tuning surface nobody asked for.
- **Automatic threshold inference** (histogram analysis of the capture) —
  deferred, not rejected: a future WP could propose a value; today the
  human chooses and the default is X-friendly.

## Consequences

- A dirty box (eraser smudge ~0.10-0.15) now lands in the doubtful band
  more often — visible in needs_review, never silently counted.
- The defaults may need another look with a semester of data: if 0.15
  produces noise, it is one number in two places (migration + worker
  constants), not a redesign.
- `scoring.stale` survives in the report for CLI users who re-read at a
  divergent seuil (PAPER-CHECK.md documents the difference).

## References

- ADR-0031 — the reading report contract (threshold reporting, `stale`).
- ADR-0048 — the annotated PDF is drawn by AMC (the third consumer of the
  threshold).
- Issue #197 — full spec, slices and the measurement that chose the values.
