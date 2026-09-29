# ADR-0048: The corrected PDF is drawn by AMC, patched through its own manual channel

**Status:** Accepted
**Date:** 2026-08-19
**Decision-makers:** Miguel Rodriguez
**Amended by:** #249 (2026-08-27) — the per-copy `amc annotate` call moved off the HTTP goroutine into the async job runner (`KindAnnotate`, `controls.NewAnnotateHandler`, `Service.AnnotateAllCleanCopies`), discharging §Consequences "async is a follow-up if courses grow". The runner is documented in ADR-0050.
**Amended by:** #298 (2026-09-22) — a RE-CAPTURED copy is born again: every correction and its annotated PDF go, its publication record stays. See §Amendment — re-capture.
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

## Amendment — re-capture (#298, 2026-09-22)

When this ADR was written a page could not be captured twice: the worker ran
AMC in photocopy mode, and a second scan stacked beside the first. Since
ADR-0075 a re-scanned page REPLACES its capture — and AMC re-uses each box's
row when it does, moving `black`/`total` to the new pixels and leaving
`manual` where it was. This ADR's promise — "the reading report honours
`manual` too, so report, score and PDF always agree" — would then hold over a
correction made against an image that no longer exists.

So a copy the batch re-captured is born again, on both sides of the seam,
before the new reading is persisted:

| What | Where | Who |
|---|---|---|
| `capture_zone.manual` on its boxes, and the forced association | AMC's capture | the worker, before `note` scores |
| `answer_override` / `rut_override` rows | server DB | `Store.ResetRecapturedCopies` |
| `reading.last_edited_at` | server DB | same transaction |
| the `annotated_copy` row | server DB | same transaction — the PDF was drawn over the old image |

**`published_at` and `published_grade` are deliberately NOT cleared.** ADR-0073
derives `CopyStale` by comparing the grade that went out with the grade the
new reading produces; clearing them would turn a student who already holds a
correction into `CopyNotSent` and erase the record that they do. The copy
then flows through the normal path — `annotateCleanCopies` redraws it if it
comes back clean, `rematchQuietly` re-files it if its RUT moved.
`TestResetRecapturedCopiesForgetsCorrectionsAndKeepsThePublication` is the
pin. A copy that comes back NOT clean has no current grade and no annotated
PDF, so ADR-0073 still derives it as sent; the analyse job's notice tells the
professor how many published copies were re-read either way.

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
