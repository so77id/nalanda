# ADR-0077: `<SequenceStepper>` gains a heap — one array drawn as a tree and as an array

**Status:** Accepted
**Date:** 2026-09-29
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #304 (Estructuras de Datos · Priority Queue y Heap).
**Extends** ADR-0074: a sixth recipe, `heap-max`, with four operations of its
own, a second picture drawn beside the first, and one addition to an existing
operation (`insert-ordered` learns to sort descending). ADR-0074 still holds
entirely; nothing in it is withdrawn.

## Context

The priority-queue class needs to show three things running, and all three
over a structure no recipe draws:

1. **The two naive implementations** — an unordered list (`insert` Θ(1),
   `extractMax` Θ(n)) and an ordered one (the reverse). Those ARE lists, and
   the widget already draws lists — but the ordered one keeps its maximum at
   `head` only if it sorts from largest to smallest. `insert-ordered` sorted
   ascending, which puts the maximum last, and removing the last node of a
   singly linked list is Θ(n) with or without `tail` (the missing piece is the
   previous node). The spec's "ordered list: `extractMax` takes the last,
   O(1)" was false on the structure the class draws.
2. **The heap** — `insert` with `swim`, `extractMax` with `sink`. The whole
   lesson of the heap is that ONE array is also a complete binary tree: node
   `k`'s children are `2k` and `2k + 1`. A widget that draws only the tree
   hides the representation the code actually manipulates; one that draws only
   the array hides why `swim` climbs `log n` levels.
3. **HeapSort** — construction (`sink` from `n / 2` down to 1) and sortdown
   (swap the root to the end, `n--`, sink), with the sorted tail growing at
   the back of the same array.

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

### 2. Four operations, valid on the heap and nowhere else

`insert`, `extract-max`, `build-heap`, `heapsort`. The heap is not a Sequence,
so none of the nine Sequence operations is valid on it and none of these four
is valid on a Sequence recipe; the refusal names the other side
("es una operación del heap. Úsala con eda="heap-max"").

`swim` and `sink` are **not** operations. They are the inside of the four —
printed under the method that calls them, so the listing never calls a method
it does not show, and their lines light up as they run. `sink` is **one**
text shared by `extract-max`, `build-heap` and `heapsort`, so the lines a
reader learns on one slide are the lines lit on the next.

### 3. Sedgewick's listing, 1-based, growing like the dynamic array

`data[0]` is never used: the parent of `k` is `k / 2` and its children `2k`
and `2k + 1`, with no `±1` anywhere — which is the reason the class gives for
the choice. `insert` grows the block with the dynamic array's own guard and
`resize(2 * data.length)` (the professor's call, #304 decision 5), shifted by
one because slot 0 is reserved: the block is full at
`n == data.length - 1`. `capacity` is `data.length`, slot 0 included, and
defaults to FULL as the dynamic-array recipe's does, so an author who does
not want the growth on screen passes a larger one.

`insert` and `extract-max` refuse a starting array that is not a max-heap:
an operation ON a heap that starts from a broken one would animate the
invariant being violated before the operation ran.

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
  last leaf while the array keeps the value — the old maximum as a dashed
  `stale` copy after `extractMax`, heapsort's `sorted` tail in `keep`. The
  tree shrinking while the array does not is exactly what `n--` means.
- **Two new cell states.** `swap`, painted in `accent` at the heavier stroke
  — the unit's "being moved" token (`teach-a-data-structure.md` §6bis) and
  Sedgewick's orange path — with the tree edge between the pair drawn the
  same. `sorted`, painted `keep`, which is a status, and heapsort's tail
  genuinely has one: nothing will move those cells again. Neither relies on
  colour alone (stroke weight; the legend; the dashed stale copy).

### 5. `insert-ordered` learns `descending`

A boolean prop, valid with `insert-ordered` only, that sorts from largest to
smallest and flips the listing's two comparisons
(`x >= head.value`, `prev.next.value > x`). It is what makes the naive ordered
priority queue a list whose `extractMax` is `deleteFirst`, Θ(1). Refused on
any other operation, and a starting chain that is not descending is refused.

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
- **The ordered list ascending with `tail`.** Still Θ(n) to remove the last
  node of a singly linked list; the dilemma the class builds would be false.
- **Sedgewick's static `sort(a)` for heapsort**, threading `n` as a
  parameter. The instance method on the heap's own `n` keeps ONE `sink`
  across the three operations (§2).

## Consequences

- The widget's validity matrix grows a row: `heap-max` × {`insert`,
  `extract-max`, `build-heap`, `heapsort`}, and those four on nothing else.
  The author guide (`add-a-course-document.md` §5h) carries it.
- The frame model gains `heapSize` and `phase`, and `SequenceCellState` gains
  `swap` and `sorted`. The Sequence recipes never set them.
- Frame counts are long for heapsort — every compare, every swap and every
  loop exit is its own frame. Eight values give roughly ninety frames. The
  class uses it on one slide, driven with the speed selector; a slide that
  wants a shorter walk passes fewer values.
- Up to eight values, as for every recipe (`MAX_VALUES`); the tree of eight
  has four levels, and the layout is sized for the largest heap of the run so
  it does not jump between frames.
- **The picture exists only in a real browser.** The frames and the geometry
  are pinned exactly (`sequenceStepperTrace.test.ts`,
  `sequenceStepperHeapLayout.test.ts`), and the component test pins which
  cells each view draws and that both paint the same state; the paint itself,
  in both themes and in both arrangements, is checked in `npm run preview`.
- `heap-min` is not built. The class's min-heap block is two slides of prose
  (the invariant turned over, and one case); a recipe with no slide to mount
  it would be the `array` recipe's story again (#296).
