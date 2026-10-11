# ADR-0077: `<SequenceStepper>` gains a heap — one array drawn as a tree and as an array

**Status:** Accepted
**Date:** 2026-09-29 (amended in the #304 slide review, 2026-10-11)
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #304 (Estructuras de Datos · Priority Queue y Heap).
**Extends** ADR-0074: a sixth recipe, `heap-max`, with two operations of its
own and a second picture drawn beside the first. ADR-0074 still holds
entirely; nothing in it is withdrawn.

## Context

The priority-queue class has to show the binary heap running. The whole
lesson of the heap is that ONE array is also a complete binary tree: node
`k`'s children are `2k` and `2k + 1`. A widget that draws only the tree hides
the representation the code actually manipulates; one that draws only the
array hides why `swim` climbs at most `⌊log₂ n⌋` levels. No recipe of
`<SequenceStepper>` drew either picture.

`teach-a-data-structure.md` §7 says a class of this unit that needs a
structure `<SequenceStepper>` does not draw adds a RECIPE to it, with an ADR,
rather than inventing a widget. This is that ADR.

## Decision

### 1. `heap-max` is a recipe of `<SequenceStepper>`, not a widget of its own

Same props, same chrome (listing on top, structure, narration strip,
controls, speed selector), same frame model — a pure trace in
`sequenceStepperTrace.ts`, a pure layout in `sequenceStepperHeapLayout.ts`, a
thin painter. The reader has watched this widget run nine operations over
five structures; the heap is read through the same surface, which is the
argument ADR-0074 made for one widget and it applies unchanged.

### 2. Two operations, valid on the heap and nowhere else

`insert` and `extract-max`. The heap is not a Sequence, so none of the nine
Sequence operations is valid on it and neither of these two is valid on a
Sequence recipe; the refusal names the other side ("es una operación del
heap. Úsala con eda="heap-max"").

The listings are written on `parent(k)`, `left(k)` and `right(k)`, the index
functions the class derives on the drawing just before the operations, never
on the inline `k / 2` and `2 * k` (#304 review): the code a student reads is
the formulas the class has just justified.

`swim` and `sink` are **not** operations. They are the inside of the two —
printed under the method that calls them, so the listing never calls a method
it does not show, and their lines light up as they run.

### 3. Sedgewick's listing, 1-based, growing and shrinking like the dynamic array

`data[0]` is never used: the parent of `k` is `k / 2` and its children `2k`
and `2k + 1`, with no `±1` anywhere — which is the reason the class gives for
the choice. `insert` grows the block with the dynamic array's own guard and
`resize(2 * data.length)` (the professor's call, #304 decision 5), shifted by
one because slot 0 is reserved: the block is full at
`n == data.length - 1`. `capacity` is `data.length`, slot 0 included, and
defaults to FULL as the dynamic-array recipe's does, so an author who does
not want the growth on screen passes a larger one.

`extract-max` shrinks the block the same way, by calling the dynamic array's
`shrinkIfSparse()` after `sink(1)`: when `n` falls to a quarter of
`data.length` the block halves and only `data[1..n]` is copied, so the stale
maxima past `n` do not survive it (the trace draws a `shrink` frame). An
empty heap starts at `new int[2]` — one usable slot plus `data[0]`, the
dynamic array's one-cell start. Both came out of the slide review of #304, so
the class can run a widget that inserts many from empty (growing
2 → 4 → 8 → 16) and one that extracts many (shrinking).

Both operations refuse a starting array that is not a max-heap: an operation
ON a heap that starts from a broken one would animate the invariant being
violated before the operation ran.

### 4. One array, two pictures

The painter draws the SAME cells as the complete binary tree (node `k` on
level `floor(log2 k)`, every parent centred over its two children) and as the
array `data[0..]` with an index rail. Both are painted from one cell state,
so the pair a `swap` exchanges is lit in the tree and in the array in the
same frame. **Stacked in the book, side by side on a slide** — the reverse of
ADR-0074's "stacked in both modes", and for the same reason read the other
way round: a chain is wide and loses legibility when halved; a tree of eight
is narrow and tall, and the correspondence between the two pictures is what
the reader has to see, which reads across better than down.

- **`data[0]`** is drawn dashed on the sunk ground with the words «no se
  usa» under it, on every frame.
- **The readout is `n`**, not `size`: it is the listing's field, and past it
  the array still holds cells that are no longer in the heap.
- **The tree draws the first `n` cells only.** After `n--` the tree loses its
  last leaf while the array keeps the value as a dashed `stale` copy. The
  tree shrinking while the array does not is exactly what `n--` means.
- **One new cell state, `swap`**, painted in `accent` at the heavier stroke —
  the unit's "being moved" token (`teach-a-data-structure.md` §6bis) and
  Sedgewick's orange path — with the tree edge between the pair drawn the
  same. It does not rely on colour alone (stroke weight, the legend).

### 5. Built and then removed in the same PR: `build-heap`, `heapsort`, `descending`

The first version of this recipe also had `build-heap` and `heapsort` (with a
`sorted` cell state and a `phase` per frame), and `insert-ordered` learned a
`descending` prop so the naive ordered priority queue could keep its maximum
at `head`. The slide review of #304 cut the HeapSort act and turned the naive
lists into prose and drawings with no widget, which left the three with no
reader in any document. They were removed before merge rather than kept for a
class that might want them: a recipe or a prop with no slide to mount it is
the `array` recipe's story again (#296), and the next class that wants
HeapSort adds it back with its own slides and its own review.

## Alternatives considered

- **A `<HeapViz>` widget of its own.** Refused by §7 of the unit guide and by
  ADR-0074's argument: a second surface for the same kind of animation makes
  the reader relearn the chrome, and every guard the widget has earned
  (listing addressed by text, runs ceiling, authoring refusals) would be
  rewritten.
- **`swim` and `sink` as operations.** They would have to start from a heap
  the author breaks by hand, which is a state no operation of the TDA
  produces. Showing them inside the operations that call them is also what
  the listing does.
- **Only the tree, or only the array.** Either hides half of the lesson (§4).
- **An `IllegalStateException` on a full block** instead of `resize`. One
  line shorter and focused on swim/sink; the professor chose the dynamic
  array's shape so the class does not teach a second growth policy.
- **Keeping `build-heap`, `heapsort` and `descending` for a future class**
  (§5). Rejected: code without a reader goes stale unseen, and its guards
  protect nothing.

## Consequences

- The widget's validity matrix grows a row: `heap-max` × {`insert`,
  `extract-max`}, and those two on nothing else. The author guide
  (`add-a-course-document.md` §5h) carries it.
- The frame model gains `heapSize`, and `SequenceCellState` gains `swap`. The
  Sequence recipes never set them.
- Up to eight values, as for every recipe (`MAX_VALUES`); the tree of eight
  has four levels, and the layout is sized for the largest heap of the run so
  it does not jump between frames.
- **The picture exists only in a real browser.** The frames and the geometry
  are pinned exactly (`sequenceStepperTrace.test.ts`,
  `sequenceStepperHeapLayout.test.ts`), and the component test pins which
  cells each view draws and that both paint the same state; the paint itself,
  in both themes and in both arrangements, is checked in `npm run preview`.
- `heap-min` is not built. The class shows the min-heap on one slide (the
  invariant turned over, drawn beside the max-heap) and then generalises to a
  heap that takes a `Comparator`, all in static drawings and code; a recipe
  with no slide to mount it would be the `array` recipe's story again (#296).
