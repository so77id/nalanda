# ADR-0060: `<MaxSubarrayViz>` — the D&C max-subarray visualiser

**Status:** Accepted
**Date:** 2026-08-31
**Decision-makers:** Miguel Rodriguez
**Covers:** the introduction of `<MaxSubarrayViz>`, the widget that traces
the divide-and-conquer max-subarray algorithm step by step on a small
integer array · the choice to trace the FULL recursion (every enter,
every return, every cross-scan position, every winner) rather than only
the top-level call · the layout choice (code panel on top, array below
with call-frame highlighting and cross-scan cursor, breadcrumb of the
call path, narration panel, controls) · the decision that Kadane's
iterative O(n) algorithm is out of scope for this widget
**Source:** Issue #266 — Course document "Diseño de Algoritmos · Divide y
Conquista". Block 2 of the deck needs a widget that makes the O(n) cross
scan visible: that scan is the key gap between max-subarray and the two
earlier D&C examples (binary search, máximo), and the reason max-subarray
lands at Θ(n log n) instead of Θ(n).

## Context

The class introduces max-subarray as the third D&C example after
binary-search and máximo. Binary-search has a constant-cost combine,
máximo has a constant-cost combine — max-subarray is the first example
where the combine step does O(n) work of its own, and that is what makes
the closed form jump to O(n log n). The widget's job is to make that
step visible: the reader has to SEE the linear scan out from `mid`, the
running accumulators, and the point where the cross winner beats (or
loses to) the two recursive winners.

Two shapes for the trace were considered during design:

- **Only the top-level call** (option A). One call frame, three
  sub-answers (left, right, cross), a single cross-scan visible. Fewer
  than 20 steps. The recursion depth would have stayed in a companion
  tree widget beside it (originally planned as `<RecursionTreeDivide>`).
- **The full recursion** (option B). Every enter, every return, every
  cross-scan position, every winner across the whole tree. For 8
  elements: ~70-75 steps. The widget shows both the combine AND the
  recursion in one place.

Miguel chose B: the two other max-subarray-adjacent widgets already
carry different parts of the story, and the full-recursion trace lets a
student who has never seen D&C in action watch it unfold. The budget of
~70 steps is manageable at 1× playback (about a minute), and the reader
who wants a specific level can jump to it with the step controls.

Kadane's iterative O(n) algorithm was proposed during design as an
addition to the code panel. Rejected: Kadane is not a D&C technique;
including it would confuse "the algorithm the widget is showing" with
"the alternative the reader might have seen elsewhere". A future WP can
introduce Kadane on its own (`<KadaneOnArray>`) as the O(n) comparison
point when DP arrives.

## Decision

**1. Trace the FULL recursion.** A pure function
`tracesMaxSubarrayDivide(values)` emits one step per meaningful moment
in the D&C recursion: enter, base, return-left, return-right,
cross-init, cross-left-scan (one per position), cross-right-scan (one
per position), cross-combine, winner. Every step carries a `path`
listing the stack of ranges from the root, so the widget's breadcrumb
can show depth without recomputing it.

**2. One row for the array, always visible.** The array cells stay in
place from step to step. What changes per step is which cells are IN
FOCUS: the current call's `[lo..hi]` reads with full colour, everything
outside is dimmed. Within the range, the left half `[lo..mid]` gets the
accent hue, the right half `[mid+1..hi]` gets the info hue, `mid` gets
a bordered emphasis. During a cross-scan the currently-examined cell
gets a stronger emphasis; on `winner` the winning sub-array cells paint
with the `keep` hue.

**3. Breadcrumb of the call path.** Below the array, a small strip reads
`Pila: [0..7] → [0..3] → [0..1]` with the current frame in accent. Two
purposes: the reader always knows where in the tree the trace is, and the
depth is legible at a glance (jumping from depth 4 back to depth 2 as
recursion returns is a signal the reader sees).

**4. Narration panel carries the current step's description AND the
running accumulators.** The three readouts (leftBest, rightBest,
crossMax) update per step; when the scan hasn't reached them, they
read `—`. On the final step the winner sub-array is called out in a
second sentence.

**5. Same lazy-composition shape as `<BinarySearchOnArray>` and
`<CallStack>`.** Composes `<CodeStepper>` for the code panel; the widget
is registered through `lazyMaxSubarrayViz.tsx`, and a per-name
architecture-test case guards no other importer reaches the real
component.

**6. Author-facing errors before render.** `values` must be a non-empty
integer array. A trace that would exceed 300 steps is refused with a
message calling out the size — the pedagogical range Miguel wants
(n = 4 or 8) fits comfortably.

**7. Kadane is deliberately not included in the code panel.** The code
shown is `maxSubarray` (D&C) and `maxCross` (the O(n) scan). Kadane
belongs to a future widget where DP or an iterative comparison is the
subject.

## Alternatives considered

**Only the top-level call (option A).** Rejected on Miguel's call — the
recursion is what makes this the third D&C example after two with
trivial combines. A single call would land the combine but not the
recursive-D&C-in-action point. The S7 pivot later confirmed this: per
ADR-0063, max-subarray is one of the algorithms that does NOT get a
companion recursion-tree widget in the deck, so this widget alone
carries both the recursion and the combine.

**Show Kadane too.** Rejected: Kadane is not D&C; it would move the
widget's focus off the pattern the whole deck is teaching. A future WP
can build a `<KadaneOnArray>` widget for the O(n) iterative comparison.

**Skip the per-position scan and collapse the whole cross into one
step.** Rejected: the linear scan IS the O(n) work that makes the closed
form O(n log n) — hiding it would collapse the very step that makes
this example distinct from the two earlier ones. The scan is the
pedagogical primitive.

**Trace only the winning sub-array as coloured cells, without the
half/mid overlays.** Rejected: the winner shows the answer, but the
combine story requires the reader to see WHY it wins — where the
crossMax came from, how the left and right recursive winners compared.
The three-halves paint carries that story.

## Consequences

**Widget count for issue #266.** This is the third of five new widgets
(five ADRs, 0059-0063; ADR-0058 for `<RecursionTreeDivide>` was
authored during S1 and deleted mid-branch — see ADR-0063 §7). Same
shape as the two before: `.tsx`,
`.test.tsx`, `.catalog.tsx`, `lazy*.tsx`, this ADR.

**Reader payload.** Pulls CodeMirror + java grammar the first time a
page mounts it — same weight already paid by pages with any Java fence.
Pages that never mount one pay nothing (the lazy wrapper +
architecture-test guard is the whole point).

**Trace budget: 300 steps.** An 8-element array produces ~74 steps; 16
elements would produce ~170; 32 elements would blow the cap. The class
uses arrays of 4-8 elements, well within budget.

**Test coverage.** Three groups:
- The pure engine (`tracesMaxSubarrayDivide`): winner correctness on the
  wikipedia array; base-case handling; path shape on every step;
  pre-order shape of the recursion; cross-combine arithmetic.
- Interactive behaviour: initial call frame highlighted; step advances
  descend into the recursion; winner announced on the last step; depth
  visible via `data-call-depth`.
- Authoring errors: missing / non-integer values; array too large.

Colour and the theme-keyed active-line paint stay the S7 browser check's
job.

**No package.json change.** Widget lives in
`apps/web/src/components/interactive/`; lucide-react and CodeMirror
already ship for the sibling widgets.
