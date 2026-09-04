# ADR-0064: `<DivideCombineTree>` gains `mergesort` / `quicksort` recipes and stepper hooks

**Status:** Accepted
**Date:** 2026-09-03
**Decision-makers:** Miguel Rodriguez
**Amends:** ADR-0063
**Covers:** two new recipes (`mergesort`, `quicksort`) for the divide/combine
recursion-tree widget · the addition of two optional props — `highlightNode`
and `nodeAnnotations` — that let another widget (`<SortStepper>`, ADR-0065)
point at a currently-executing call and inject a per-chip in-flight
annotation · the deliberate choice to expose these hooks on the tree
widget rather than fork a second one · the pedagogical pivot policy for
the `quicksort` recipe
**Source:** Issue #268 — Course document "Diseño de Algoritmos ·
Ordenamiento". `<SortStepper>` needs a tree component that can show
mergesort/quicksort partitions AND accept a "you are here" mark from a
running stepper. The alternative — a second recursion-tree widget —
would fragment the D&C tree vocabulary the class just built in #266.

## Context

Issue #266 shipped `<DivideCombineTree>` (ADR-0063) as the axis widget
of the divide-and-conquer class: every chip carries the CALL arguments
(top) and the RETURN value (bottom), and the tree SHAPE carries the
pedagogy — `max` a wide binary tree, `binary-search` a linear chain,
`max-subarray` a binary tree with L/R/✕ intermediates.

Issue #268 is the next class ("Ordenamiento"). It re-uses the same
axis: mergesort and quicksort are the canonical divide-and-conquer
sorting instances, and their trees are the reason the class ended on
the *"BS necesita ordenado → cómo se ordena rápido"* thread. Two facts
change from #266:

1. The trees are consumed by another widget — `<SortStepper>`
   (ADR-0065) — that walks a step-by-step animation of the algorithm.
   The stepper needs a way to tell the tree "this call is where I am
   right now" so the reader can visually correlate the current
   partition/merge with its position in the recursion.
2. The middle row of a chip needs to be programmable per-chip, not
   just per-recipe. Mergesort has nothing to show at rest but "merge
   buffer parcial" while active; quicksort shows `pivot=x` always and
   the partition zones while active.

The status quo (a fixed per-recipe middle row via the recipe's
`intermediates`) cannot express those two requirements.

## Decision

**1. Two new recipes: `mergesort` and `quicksort`.**

- `mergesort` — binary tree by mid split, one element per leaf.
  Chip top: `mergesort([...])`. Chip bottom: sorted subarray
  `[1,3,5,7]`. No middle by default (the classroom talk supplies the
  merge story in prose; the stepper supplies the buffer via
  `nodeAnnotations` when needed).
- `quicksort` — tree partitioned by pivot; `left = { x ∈ rest : x <
  pivot }`, `right = { x ∈ rest : x ≥ pivot }`. Chip top:
  `quicksort([...])`. Chip middle: `pivot=x` on internal chips
  (base cases have nothing to pivot on). Chip bottom: sorted
  subarray.

**2. Pivot policy for `quicksort`: first element of the subarray.**

The class teaches, in prose, that stdlib uses shuffle + median-of-3;
the widget shows the STRUCTURE of the partition rather than the
production choice. First-element is deterministic, reads left-to-right
in the chip label, and — on an adverse input — visibly produces the
degenerate n² shape that motivates the shuffle trick. If a later class
needs a second policy, a `quicksort-m3` recipe is a code change of the
same shape as adding `max-subarray` was in #266.

**3. `highlightNode?: string` — "you are here" from a stepper.**

When set, the chip whose `call` matches exactly is rendered with a
focus ring (`ring-2 ring-focus`) and exposes
`data-highlighted="true"`. Absent or non-matching: no highlight.
Matching by call string is enough for the classroom-size arrays this
widget renders (≤ 8 elements per side of a partition); a duplicate
label would highlight both, which is the correct semantics for a
"this call" mark.

**4. `nodeAnnotations?: Record<string, string>` — per-chip middle-row
override.**

When a chip's `call` is a key, the value replaces the chip's middle
row. This is what `<SortStepper>` uses to say "at this frame,
`mergesort([3,7,1,5])` is combining `[3,7]+[1,5]`" or "at this frame,
`quicksort([3,7,1,5])` has just placed 3 as the pivot and is scanning
left/right". Absent or key-missing: the chip renders the recipe's
default middle row (pivot for quicksort, L/R/✕ for max-subarray, or
nothing for the rest).

**5. Amend, don't fork.**

The alternative — a second widget `<SortRecursionTree>` — was
rejected. The D&C class in #266 already made the two-row chip and the
tree-shape-carries-cost pattern the vocabulary of divide-and-conquer;
a second widget would fragment that vocabulary and force the reader
to translate between two visual dialects. The hooks (`highlightNode`,
`nodeAnnotations`) are small enough that the widget grows two optional
props without changing the shape of what it draws by default.

**6. Existing recipes stay green.**

The `max`, `max-subarray`, `binary-search` recipes DO NOT change.
Their tests stay green (verified by `DivideCombineTree.test.tsx`).
The new props default to undefined, so authored callers from #266
continue to render identically.

## Alternatives considered

**Fork `<SortRecursionTree>`.** Rejected — see §5. Two widgets that
draw the same picture confuse authors and split the D&C vocabulary
built in #266.

**Match `highlightNode` by node id rather than call string.** Rejected:
introducing an id scheme would force `<SortStepper>` to reconstruct
the same tree to know the ids. Matching by call gives the stepper a
label it already computes as part of its own state.

**Bake merge-buffer / partition state into the recipes themselves.**
Rejected: that would push algorithm-execution state into the tree
widget, which is meant to be static structural. Making the middle
row overridable per-chip lets the stepper own the state, and the tree
own the shape.

**Median-of-3 pivot for the `quicksort` recipe.** Rejected as the
default: first-element makes the pattern of partitioning legible
left-to-right and lets an adversarial input show the degenerate n²
shape the deck explicitly names. A `quicksort-m3` recipe can be
added later without touching this one.

## Consequences

**`<SortStepper>` (ADR-0065) can render the tree it needs without a
second component.** It composes `<DivideCombineTree recipe="mergesort"
/>` or `.../ quicksort />` inside its own layout and passes
`highlightNode` + `nodeAnnotations` as its frame advances.

**Two new author-facing recipes** available immediately in `content/`,
without going through the stepper — the class deck uses them both as
static trees in the D&C section, and the stepper uses them again with
the hooks in the "run the algorithm" section.

**No test regressions.** The three existing recipes are unchanged and
their tests are unchanged. New tests cover: the two new recipes'
structure and returns, `highlightNode` marking exactly one chip,
`nodeAnnotations` overriding the chip's middle row, and a regression
guard that existing recipes render with no highlight when the new
props are absent.

**No `package.json` change.**

**Reader payload.** Same shape as ADR-0063: SVG-free chips, no new
libraries. The eager-graph walk in `src/architecture.test.ts` stays
green.
