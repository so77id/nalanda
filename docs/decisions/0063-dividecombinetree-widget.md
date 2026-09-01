# ADR-0063: `<DivideCombineTree>` — the divide/combine axis widget

**Status:** Accepted
**Date:** 2026-08-31
**Decision-makers:** Miguel Rodriguez
**Covers:** the introduction of `<DivideCombineTree>`, a recursion-tree
widget where each chip shows the CALL arguments (top row) and the RETURN
value (bottom row), making the divide (down) and combine (up) flows
visible on real data · the choice to draw the tree statically, opened
fully, without a cost rail · the two recipes at v1 (`max` and
`binary-search`) that expose the two extreme tree shapes (wide binary
vs linear chain) side by side · the deliberate REMOVAL of the earlier
`<RecursionTreeDivide>` widget (ADR-0058, deleted mid-development) in
favour of this simpler shape
**Source:** Issue #266 — Course document "Diseño de Algoritmos · Divide
y Conquista". During visual iteration on the deck, Miguel decided that
`<RecursionTreeDivide>` (the per-level cost-rail widget shipped in S1)
did not serve the pedagogy well — its cost breakdown obscured the more
fundamental question the reader needs to answer first: *"what does the
recursion actually do, and how does the answer propagate back up?"*.

## Context

The class opens the "Diseño de Algoritmos" unit by giving the
divide-and-conquer pattern its name, then walking through five examples
(máximo, búsqueda binaria, max-subarray, closest-pair, Karatsuba). For
each, the reader needs to see two things:

1. The **structural** dynamic: divide → recurse → combine.
2. The **cost**: the closed form of the recurrence.

The first widget shipped for this WP (`<RecursionTreeDivide>`,
ADR-0058) tried to do both at once — a recursion tree with a per-level
cost rail on the side, closed form at the foot. In visual iteration,
Miguel judged that the cost rail was mechanical and obscured the more
important pedagogical question. His preferred pedagogy is:

- SHOW the recursion tree with what divides and what combines, on real
  data.
- STATE the closed form of the recurrence directly (from expansion or
  from the Master Theorem — both mentioned, neither derived in class).

So the widget's job narrows: draw the tree, make the two flows
(divide down, combine up) visible on each node. Cost analysis lives in
prose beside the widget.

## Decision

**1. Two-row chip per node.** Every chip has a top row (the CALL
arguments, e.g. `max([3,7])`) and a bottom row (the RETURN VALUE, e.g.
`↑ 7`). The visual signature is "what came in, what goes out". A base
case chip is distinguished by a different border/background (accent for
internal, keep for base).

**2. Two recipes: `max` and `binary-search`.**
- `max` is a **binary tree**, one leaf per input element. `values`
  authors the array. The tree shape (wide, 2^L nodes at level L, N
  leaves) is what visually justifies the `Θ(N)` result — the leaves
  dominate.
- `binary-search` is a **linear chain**, one call per level, only the
  path the search actually takes. `values` (strictly increasing) and
  `target` are authored. The tree shape (deep, one node per level, one
  leaf) is what visually justifies the `Θ(log N)` result — only depth
  matters.

Two recipes deliberately chosen to expose the **two extreme tree
shapes** side by side in the deck. Adding a third recipe (e.g.
`mergesort` when the next class arrives) is a code change of the same
shape as adding one to `<RecursionTree>`.

**3. Static — no playback, no click-to-expand.** Same convention as
`<RecursionTree>` after Miguel's Peli 2 review: a slide reader gets
more from seeing the shape all at once than from clicking through it.
The whole tree is drawn on mount.

**4. No cost rail, no closed-form annotation on the widget itself.**
The recurrence and its solution live in prose beside the widget in the
slide. This is the deliberate simplification vs `<RecursionTreeDivide>`
— the widget is about STRUCTURE, the analysis is text.

**5. Author-facing errors before render.** `values` must be a non-empty
array. `binary-search` also requires `target` and a strictly increasing
`values`. A tree exceeding 100 nodes is refused with an authoring
error.

**6. Node cap of 100.** `max` on 32 elements is 63 nodes (fits); 64
elements is 127 nodes (refused). `binary-search` chains scale with
log(N) — even a 1000-element input is a chain of 10 nodes. The cap
protects against authoring typos, not against the pedagogical range.

**7. `<RecursionTreeDivide>` (ADR-0058) is deleted, not superseded.**
Because ADR-0058 was authored on this branch and never merged to main,
its full removal (widget files, tests, catalog entry, wire-ups, and
the ADR itself) is a straight deletion in the same PR that ships this
widget — the git history is the record. Had it shipped and later been
retired, standard supersede semantics would apply.

## Alternatives considered

**Keep `<RecursionTreeDivide>` and add this one beside it.** Rejected:
they answer overlapping questions (both draw the recursion tree). Two
widgets doing similar things confuse authors about which to pick, and
the cost rail was the specific piece Miguel found not to work — keeping
it and adding a simpler tree wouldn't recover the pedagogy.

**One recipe (`max` only) and use `<BinarySearchOnArray>` for BS.**
Rejected: `<BinarySearchOnArray>` shows the algorithm running on the
ARRAY (cells, lo/mid/hi markers). It doesn't show the recursion tree
shape. The linear-chain shape of BS's recursion is the pedagogical
counterpoint to `max`'s wide binary tree, and needs the same tree
widget to make the comparison work.

**Add return-arrow paths as visual glyphs between chips.** Considered
but rejected as visual noise: the two-row chip already carries "what
came in, what goes out" per node. Adding double connectors on every
edge would double the visual weight without adding information — the
FOOTER of the widget explains the reading once.

**Interactive expand/collapse.** Rejected on the same grounds as
`<RecursionTree>`: on a slide, seeing the whole shape at once is more
readable than click-through.

## Consequences

**Widget count for issue #266.** With ADR-0058 removed and ADR-0063
added, the WP ships five widgets: `<DivideCombineTree>`,
`<BinarySearchOnArray>`, `<MaxSubarrayViz>`, `<ClosestPairViz>`,
`<KaratsubaViz>` — same count as originally planned, one substituted.

**Deck simplification.** The four "árbol" slides that used
`<RecursionTreeDivide>` in the earlier draft are removed. Their closed
forms are now stated in the "D&C" slide of each algorithm.
`<DivideCombineTree>` appears twice: once for `max` and once for
`binary-search`, exposing the two extreme tree shapes back to back.
Later algorithms (max-subarray, closest-pair, Karatsuba) do NOT get a
recursion-tree widget — their D&C slide simply states the recurrence
and its closed form, with the per-algorithm visualiser
(`<MaxSubarrayViz>`, `<ClosestPairViz>`, `<KaratsubaViz>`) doing the
"what the algorithm does on real data" work.

**Reader payload.** Small SVG-free chip layout, same shape as
`<RecursionTree>`. Not lazy. The eager-graph walk in
`src/architecture.test.ts` stays green.

**Test coverage.** Structural + authoring:
- `max` renders one leaf per element with per-chip return values
  matching the recursion.
- `binary-search` renders only the path taken (calls not on the path
  are absent from the DOM); return propagates up as the found index or
  `-1`.
- Authoring errors: unknown recipe, missing values, missing target for
  BS, non-monotonic values for BS, tree over the node cap.

Colour and per-recipe theme paint stay the S7 browser check's job.

**No package.json change.**
