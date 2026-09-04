# ADR-0066: `<DecisionTreeSort>` — the log₂(N!) lower-bound widget

**Status:** Accepted
**Date:** 2026-09-03
**Decision-makers:** Miguel Rodriguez
**Covers:** the introduction of `<DecisionTreeSort>`, a static widget
that visualises the decision tree of a comparison-based sorting
algorithm for n ∈ {2, 3, 4}, together with the data panel that names
N!, the tree height, and the ⌈log₂(N!)⌉ bound · the choice to render
the BALANCED-SPLIT tree (rather than a specific algorithm's tree) so
the height matches the bound exactly and the reader sees the argument
made tight · the deliberately small size cap (up to n=4) because
beyond four elements the tree becomes illegible on a slide
**Source:** Issue #268 — Course document "Diseño de Algoritmos ·
Ordenamiento". The class argues that N log N is the tight lower
bound for any comparison-based sort; the argument needs a visual —
the decision tree — that the reader can COUNT: N! leaves, height
≥ log₂(N!).

## Context

The "Ordenamiento" class walks the reader through five sorts and
lands on the question: *"can we do better than N log N?"*. The
answer is: NO, for comparison-based sorts, and YES if you assume
something about the data (counting/radix). The NO side is the
information-theoretic argument via decision trees:

- Any deterministic comparison-based sorting algorithm can be modeled
  as a binary tree where each internal node is a comparison ("a < b?")
  and each leaf is a possible input permutation.
- The tree must have at least N! leaves (one per possible input
  permutation, to distinguish them all).
- A binary tree with N! leaves has height at least ⌈log₂(N!)⌉.
- By Stirling, log₂(N!) = Θ(N log N).

The class's rhetorical move is: *"look at the tree — count the leaves,
count the depth. The bound isn't 'the best algorithm we know', it's
'the shape any answer must have'."* The widget needs to render that
picture so the reader can see and count.

## Decision

**1. Balanced-split tree, not a specific algorithm's tree.**

Any concrete algorithm (insertion, mergesort, quicksort) produces a
valid decision tree, but its height is usually greater than
⌈log₂(N!)⌉ — the tight bound is achieved by a hypothetical algorithm
that always picks the comparison splitting the remaining
permutations 50/50.

The widget renders THAT tree: at every internal node, it picks the
comparison (i,j) that most evenly divides the surviving permutations.
Result: the height exactly matches ⌈log₂(N!)⌉ (verified by
`decisionTreeSort.test.ts`). The reader sees the argument made tight.

Rendering a specific algorithm's tree would make the picture harder
to reconcile with the ⌈log₂(N!)⌉ formula ("but the tree I see has
height 7, and log₂(6!)≈9.5 says height ≥ 10"). Since the pedagogical
point is the bound and not the algorithm, the balanced tree is the
honest visual.

**2. Only n ∈ {2, 3, 4}.**

- n=2: 2 leaves, height 1 — the trivial base.
- n=3: 6 leaves, height 3.
- n=4: 24 leaves, height 5.
- n=5: 120 leaves, height 7 — too dense to read on a slide.

The n prop is `2 | 3 | 4` at the type level; anything else returns an
author-facing error naming the accepted values.

**3. Static tree, one interactive toggle.**

- The whole tree renders on mount.
- One button: "Mostrar peor caso" toggles a focus ring along the path
  from root to a leaf at the maximum depth (any leaf whose depth
  equals the tree height is a "worst case").
- Every leaf carries `data-depth` (its comparison count from the
  root) and a `title` attribute so hover shows the count. No JS
  needed for the hover.

Rejected alternatives:
- Click-to-step through the tree (added visual noise without new
  pedagogical value; the reader already sees the whole tree).
- Animated draw-in on mount (same reason; the tree is small).

**4. Data panel on the side with the counts made visible.**

`showBound` (default true) renders a sidecar with:
- `hojas` = N! (raw count and factorial notation).
- `altura` = height of the drawn tree.
- `cota inf.` = ⌈log₂(N!)⌉.
- A one-sentence note connecting log₂(N!) ≈ N log N via Stirling.

The panel closes the pedagogical loop: the reader can COMPARE the
rendered tree's altura with the theoretical cota inf. and see they
match — that's the argument in one glance.

**5. Same visual family as `<DivideCombineTree>` / `<RecursionTree>`
— SVG-free chip layout with pseudo-element connector lines.**

Consistency with the D&C tree widget the reader has just been using
in the same class. Two chip kinds: `internal` (the comparison "x < y ?")
and `leaf` (the sorted permutation and its comparison count).

**6. Eager, not lazy.**

No CodeMirror, no runtime seam, no chart library — same import shape
as `<DivideCombineTree>` and `<RecursionTree>`. Registered directly in
`mdxComponents.ts`. The eager-graph walk in `architecture.test.ts`
stays green.

## Alternatives considered

**Render insertion sort's decision tree.** Rejected: insertion sort's
tree has height n(n-1)/2 in the worst case (6 for n=4, matching the
balanced tree only coincidentally, and 10 for n=5, above the bound).
The mismatch between "tree height" and "⌈log₂(N!)⌉" would confuse the
argument. See §Decision.1.

**Show all N! ≥ 6 leaves for n up to 5 or higher.** Rejected: n=5
produces 120 leaves and depth 7 — no slide holds it legibly. The
argument scales in the reader's head with N; a smaller worked example
is enough to make it, and the widget names N and ⌈log₂(N!)⌉ in the
data panel so the reader can extrapolate.

**Interactive "click a leaf, walk the path back".** Rejected as
premature: the static tree already shows the paths. If a later class
needs a walked-path visualisation, a separate widget or a follow-up
extension would carry it — this WP keeps it out.

**Compose `<DivideCombineTree>` with a new recipe.** Rejected: the
tree structure is different (binary decision, not divide/combine),
and the chip shape differs (a comparison, not a call + return). A
separate widget avoids overloading `<DivideCombineTree>`'s
vocabulary.

## Consequences

**One-slide argument for the lower bound.** The section 8 slide can
render `<DecisionTreeSort n={3} />` alone and the reader has: the 6
leaves, the depth-3 shape, and the sidecar naming ⌈log₂(6)⌉ = 3. The
"asumir cosas sobre los datos es ingeniería" pivot to counting/radix
comes in prose immediately after.

**Tests.** Two files:
- `decisionTreeSort.test.ts` — pure: N! leaves, height =
  ⌈log₂(N!)⌉, distinct leaf outputs, worst-case leaf is at height.
- `DecisionTreeSort.test.tsx` — widget contract: authoring error for
  n ∉ {2,3,4}, correct leaf and internal counts, unique data-sorted
  strings, worst-case toggle highlights exactly one leaf at maximum
  depth, showBound false hides the data panel.

Layout, focus rings and paint stay the S5 browser check's job.

**Reader payload.** Same shape as `<DivideCombineTree>` /
`<RecursionTree>` — SVG-free, no new libraries. Eager import; the
eager-graph walk in `src/architecture.test.ts` stays green.

**No `package.json` change.**
