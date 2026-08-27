# ADR-0048: The corrected PDF is drawn by AMC, patched through its own manual channel

**Status:** Accepted
**Date:** 2026-08-19
**Decision-makers:** Miguel Rodriguez
**Source:** #190 (every copy ends the control cycle with an annotated PDF),
conversation 2026-08-19 after the first real production control (#186–#189).

## Context

The review page lets the professor correct what AMC read, but the cycle had
no closing artefact: the corrections lived in the server's override tables and
AMC never saw them. AMC already draws the corrected sheet (`amc annotate`), so
the question was only how to make it draw the professor's version rather than
the original reading.

Two approaches:

- **(A) Patch AMC's capture, then annotate** — write the overrides into
  `capture_zone.manual` (AMC's own manual-correction column, the one its GUI
  writes when a human clicks a box), re-run `note`, run `annotate` in
  single-copy mode (`--id-file` + `--single-output`).
- **(B) Draw our own annotated PDF in Go** — re-render marks, scores and
  verdicts over the scan images ourselves.

**(A) shipped.** All writes to AMC's sqlite files live in the worker
(`apps/amc-worker`), behind `POST /annotate/copy`; the server sends
`{project, copy, overrides}` as JSON. The reading report honours `manual`
too, so report, score and PDF always agree.

## Alternatives considered

- **Draw our own annotated PDF in Go** — full control, no private schema.
  Rejected for this WP: it re-implements AMC's whole drawing pipeline
  (marks, correct answers, per-question scores, verdict) before it has
  produced one value; revisit when an AMC update breaks (A) or a needed
  shape is beyond AMC's drawer.
- **Overrides as a persistent delta** — apply only the boxes the professor
  changed and leave the rest. Rejected after review: a reverted correction
  (server clears the override row, sends nothing) would leave its old
  patches in the capture and the PDF would silently show the correction
  the professor undid. Every annotate therefore RESETS the copy's manual
  columns and re-applies the whole desired state.

## Decision

- The annotated PDF per copy lives at `<project>/annotated/copy-<N>.pdf`,
  tracked by the `annotated_copy` row; the review page embeds it and falls
  back to the raw scan while no row exists.
- Two triggers converge on one domain method: auto after `/analyse` for
  `status:ok` copies, manual after every review save (with the just-saved
  overrides).
- `NALANDA_ANNOTATE_ENABLED` (default true) is the master switch: false
  means no worker calls, no rows, raw scans everywhere — the escape hatch if
  the approach breaks against a real batch.

## Consequences

**Positive:** reuses AMC's whole drawing pipeline (marks, correct answers,
per-question scores, verdict) instead of re-implementing it; the override
channel is AMC's own, so `note` and `annotate` honour it natively.

**Negative / trade-offs:**
- `capture_zone`/`layout_*` layouts are AMC's private schema, not a public
  contract. Measured against AMC 1.6.0; an upstream change can break the
  patch silently — the **Review trigger** in `docs/security-notes.md`
  §"The control worker is unauthenticated and trusts its only caller" is
  the alarm, and the env-var is the rollback.
- One `amc annotate` per copy is seconds-class and synchronous inside the
  review save. Accepted for this scale; async is a follow-up if courses grow.

## Review triggers

- **Revisit (B)** when an AMC update breaks the patch, when the annotated PDF
  needs shapes AMC cannot draw, or when per-copy annotate becomes a
  throughput problem.
- **Re-measure the paper check** (PAPER-CHECK.md, AC-9 of #190) — the one
  verification no agent can run; its outcome decides whether this ADR stands.

## References

- ADR-0030 — the AMC engine and its traps (§Not yet proven: the paper check).
- ADR-0037 — the scan-page path contract the review page binds to.
- `apps/amc-worker/worker.py` — `/annotate/copy` and `apply_overrides`.
- `apps/server/internal/domain/controls/annotate.go` — the domain method.
- Issue #190 — full spec, slices and acceptance criteria.
