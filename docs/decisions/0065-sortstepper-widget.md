# ADR-0065: `<SortStepper>` — the axis widget of the sorting class

**Status:** Accepted
**Date:** 2026-09-03
**Decision-makers:** Miguel Rodriguez
**Covers:** the introduction of `<SortStepper>`, a step-through widget
that traces one of five sorting algorithms (bubble, selection,
insertion, mergesort, quicksort) frame by frame — code on top, bars
in the middle, controls at the foot · the choice to precompute the
whole trace eagerly rather than drive the algorithm live · the
composition with `<DivideCombineTree>` (ADR-0064) for the D&C
algorithms so the recursion tree and the array visualisation stay in
sync · the algorithm-specific overlays (sorted prefix / suffix,
active pair, pivot zone, aux rail) rendered on a shared bar chart ·
the pivot policy for quicksort that aligns with the tree recipe
**Source:** Issue #268 — Course document "Diseño de Algoritmos ·
Ordenamiento". The class walks the reader through five algorithms
with the pedagogical rule *idea → código → widget → análisis →
propiedades*. This is the widget that lands in every algorithm's
"widget" slot.

## Context

The "Ordenamiento" class covers three elementary n² sorts (bubble,
selection, insertion) and the two canonical D&C n log n sorts
(mergesort, quicksort). The pedagogical rule for every algorithm is
the same: present the naïve code, show the algorithm running on real
data with a widget the reader can drive, then discuss the analysis
and properties.

For the class to be coherent, all five algorithms need the same
widget vocabulary — same shape, same controls, same visual grammar.
A per-algorithm widget would force the reader to relearn the mapping
"bar colour → status" five times.

The mergesort/quicksort widgets have an extra requirement: the
class already gave the reader the divide/combine recursion tree in
#266 (ADR-0063), and the "cost visible on the tree shape" pedagogy
carries into this class. The stepper for merge/quick must show the
tree alongside the bars and mark WHERE in the tree the current
frame is executing — otherwise the algorithm feels detached from
its recursion structure.

## Decision

**1. One widget, five algorithms, one visual grammar.**

`<SortStepper algorithm={...} values={...}>` renders:

- `<CodeStepper>` on top with the algorithm's pseudocode and the
  current line highlighted (same seam `<BinarySearchOnArray>` uses,
  ADR-0059).
- A shared bar chart below: one bar per array element, height
  proportional to value. Per-frame overlays via `data-status` on
  each bar:
  - `sorted` — proven-ordered prefix (insertion / selection) or
    suffix (bubble).
  - `active` — the indices the algorithm is looking at this frame.
  - `pivot` — the pivot's current index (quicksort).
  - `out-of-range` — outside the current recursive subarray
    (mergesort / quicksort), rendered greyed.
- Controls at the foot: reset, prev, play/pause, next (same shape
  as `<BinarySearchOnArray>`, `<HanoiPlayground>`).

**2. Precomputed traces via `sortStepperTrace.ts`.**

Each algorithm has a pure function (`traceBubble`, `traceSelection`,
etc.) that returns the full frame list. The widget replays the list;
the algorithm itself never runs at render time. This gives:

- Frames the suite can pin without touching the DOM (tests live in
  `sortStepperTrace.test.ts`).
- Reset / step-back that are just `stepIndex--`, not a re-run.
- Deterministic frame count for the reader's "Paso k/N" indicator.

The trace is memoised on `(algorithm, valuesKey)` — the same pattern
`<BinarySearchOnArray>` uses to survive MDX's inline-array
re-referencing.

**3. Composition with `<DivideCombineTree>` for `merge` and `quick`.**

For the two D&C algorithms, the widget renders
`<DivideCombineTree recipe="mergesort"|"quicksort" values={...}>`
beside the bars. The current frame's `callNode` is passed as
`highlightNode` and — when the algorithm annotates the frame — the
in-flight text is passed via `nodeAnnotations`. Both hooks are the
ADR-0064 additions.

The trace's `callNode` labels are computed to match the tree
recipe's chip labels exactly, so the match is by call string and
lands on the right chip. The `sortStepperTrace.test.ts` includes a
cross-widget contract test — quicksort's stepper emits calls
`quicksort([1])` and `quicksort([7,5])` because those are the chip
labels the tree recipe draws.

For the n² algorithms `showTree` has no effect — there is no tree,
and the widget renders bars alone.

**4. Quicksort pivot = first element, out-of-place partition.**

The stepper's quicksort scans left-to-right, classifying each
element as "< pivot" or "≥ pivot" and materialising a partitioned
array on the canvas at the end of each recursive call. This matches
the `<DivideCombineTree recipe="quicksort">` recipe exactly (same
pivot, same filter split), so `highlightNode` lands on the right
chip and the two widgets stay coherent.

The class deck explains, in prose, that stdlib uses shuffle +
median-of-3 (Sedgewick's "más probable que te caiga un rayo" line);
the widget shows the PATTERN, not the production choice. First-
element is chosen because it (a) matches the tree recipe, (b) reads
left-to-right in the chip label, and (c) exposes the degenerate n²
shape on adverse input if the deck ever wants to demonstrate it.

**5. Autoplay off by default; `slow` / `normal` / `fast` speed.**

Rule Peli 1/2: the widget waits for the reader's first click. The
`speed` prop authors the playback delay (1200ms / 700ms / 300ms per
frame) when the reader hits play.

**6. Array cap of 12; recommended 6-10.**

Beyond ~10 elements the frame count grows past what a reader can
follow at classroom pace; beyond 12 the bar chart becomes illegible.
The cap is enforced as an author-facing error, not a truncation.

**7. Lazy-loaded, same shape as ADR-0059/60/61/62.**

The widget composes `<CodeStepper>` (CodeMirror + java grammar) and
`<DivideCombineTree>`. Registered in `mdxComponents.ts` behind
`<LazySortStepper>` so CodeMirror stays off the entry chunk of
readers of pages that mount no stepper. Guarded by a per-name case
in `src/architecture.test.ts`.

## Alternatives considered

**One widget per algorithm.** Rejected: five widgets doing the same
thing would force the reader to relearn the visual grammar per
algorithm, and would duplicate the control layout, the code panel
and the accessibility work five times.

**Drive the algorithm live at render time.** Rejected: reset and
step-back would need to re-run the algorithm; the frame count would
depend on the trace; and every render would recompute. Precomputing
is memoised, deterministic, and testable in isolation.

**Match `highlightNode` by node id rather than call string.**
Rejected on the same grounds as ADR-0064 §Alternatives: the widget
already computes the call label as part of its trace; an id scheme
would force it to reconstruct the tree just to know what to name.

**In-place Lomuto or Hoare partition for quicksort.** Rejected as
the default: the resulting subarrays would not match the
`<DivideCombineTree>` quicksort recipe (they reorder elements
before recursing), so `highlightNode` would land on the wrong chip
or on none. The pedagogical loss of "not the real in-place
partition" is stated in prose in the deck; the class deliberately
does not teach in-place quicksort — its class on 3-way partition
belongs later.

**Show all n² algorithms on the same bar chart with a stacked
overlay.** Rejected: the class introduces them one at a time, and
comparing them belongs in `<Benchmark>` (empirical timings) rather
than in the stepper.

## Consequences

**Five slides get one widget.** The n² section uses `algorithm=`
`bubble` / `selection` / `insertion`; the D&C section uses `merge` /
`quick`. Each slide reads the same visual grammar.

**Cross-widget coherence for D&C.** The bar chart and the recursion
tree tell the same story with the same labels: the frame the reader
is looking at is highlighted on the tree, and the tree's chip carries
the in-flight annotation. Debugged as a contract in
`sortStepperTrace.test.ts`.

**Tests.** Two files:
- `sortStepperTrace.test.ts` — pure, per-algorithm: terminal frame
  is sorted, snapshots are permutations, frame kinds match the
  algorithm's phases, `callNode` labels match the tree recipe.
- `SortStepper.test.tsx` — widget contract: authoring errors, bar
  `data-status` on the initial frame, controls advance/rewind/reset,
  `<DivideCombineTree>` renders with the right recipe for merge/quick,
  `highlightNode` matches the initial call, aux rail appears only
  once a merge-take frame arrives.

Bar layout, focus rings, and paint stay the S5 browser check's job.

**Entry-chunk guard.** New per-name case in
`src/architecture.test.ts` asserts `SortStepper` is imported only by
`lazySortStepper.tsx`. Any future edit that adds a static import
from another file fails this test with the file name.

**Reader payload.** Same shape as the other lazy widgets — the
CodeMirror + java grammar chunk loads on demand the first time the
page mounts a stepper.

**No `package.json` change.**
