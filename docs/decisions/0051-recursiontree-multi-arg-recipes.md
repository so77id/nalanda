# ADR-0051: Multi-argument recipes in `<RecursionTree>` (Hanoi extension)

**Status:** Accepted
**Date:** 2026-08-27
**Decision-makers:** Miguel Rodriguez
**Covers:** the extension of `<RecursionTree>`'s recipe surface to support
recursions whose arguments carry more than a single integer (Hanoi) · the
label template `hanoi(N, from → to)` that shows `n` and the tower transition
but hides `aux` · the introduction of a `colorStrategy` on recipes so
Hanoi's tree paints uniformly (its pedagogical signal is the absence of
repetition, not the sharing of colour)
**Source:** Issue #221 — Acto 5 of the redesigned Peli 2 uses Torres de
Hanoi as the memoization counter-example. Slide 5.8 needs a `<RecursionTree
recipe="hanoi" arg={3}>` to visualize the recursion tree; the widget did
not previously support hanoi.

## Context

The original `<RecursionTree>` (introduced with `fib` and `factorial`) has
a `Recipe` type keyed on a single number:

```ts
type Recipe = {
  label: string;
  children: (arg: number) => number[];
};
```

For Fibonacci and factorial, that single integer IS the state — every node
in the tree is identified by its `n`. Two nodes with the same `n` are the
same call, and the widget's coloring strategy paints them the same hue on
purpose: the visual signal that recursive Fibonacci is slow is the SHARED
COLOUR of duplicated subproblems.

Torres de Hanoi breaks that model. A hanoi call is
`hanoi(n, from, to, aux)` — four arguments. Two nodes with the same `n`
are different calls if their tower assignments differ; the tree therefore
does not have the "same argument, same colour" property that Fibonacci
does. What it has is the OPPOSITE property, which is the pedagogical
point: Hanoi is a counter-example to memoization because there are no
duplicated (functional) subproblems to cache, and even if there were, the
work is a side effect (a physical disc move) that cannot be memoized
anyway.

## Decision

**1. Generalize the recipe state to a `NodeState` interface.** A state has
a required `n: number` and an optional `extras: string[]`. Numeric
recursions (`fib`, `factorial`) leave `extras` unset and behave exactly as
before. Hanoi carries the three tower names as extras. The interface is
exported so future non-numeric recipes can extend by the same pattern.

**2. Recipes now provide `format`, `seed`, `children`, and
`colorStrategy`.**
- `format(state)` — how a node reads on the page. Fibonacci returns
  `fib(3)`; factorial returns `factorial(4)`; hanoi returns
  `hanoi(n, from → to)`.
- `seed(arg)` — how the top-level numeric `arg` prop becomes the root
  state. Fibonacci/factorial seed to `{ n: arg }`; hanoi seeds to
  `{ n: arg, extras: ['A', 'C', 'B'] }` — fixed tower names, matching
  the code snippet in the Acto 5 slide.
- `children(state)` — the same shape as before, generalized over
  `NodeState` instead of just `number`.
- `colorStrategy` — `'by-arg'` (existing behaviour: hue rotates by `n`,
  duplicates share colour) or `'uniform'` (all nodes paint the same
  hue). Hanoi chose `'uniform'` because there is no colour-sharing
  signal to send: every call is a distinct piece of work.

**3. Hanoi's label omits the auxiliary tower.** `hanoi(2, A → B)` is more
readable on a slide than `hanoi(2, A → B, aux: C)`. The `aux` is still in
the state and drives the children correctly; the reader who cares can
infer it from context (the third tower). Miguel confirmed this in
refinement.

**4. Hanoi's tree may repeat `(n, from, to, aux)` tuples at depth ≥ 3, and
the widget does not deduplicate.** The tree is a faithful drawing of the
call graph, not a memoized DAG. The footer message under a hanoi tree
therefore does NOT claim "no llamadas repetidas" (which would be false in
general); it says instead that Hanoi's work is intrinsic — each call
produces a side effect that cannot be cached. Same pedagogical
conclusion, honest wording.

**5. Compound authoring surface stays SIMPLE.** The author writes
`<RecursionTree recipe="hanoi" arg={3} />` — a single integer, same as
fib. No tuple prop, no configuration for tower names, no
customization of the label template. The recipe knows how to draw itself.

## Alternatives considered

**Change `arg` to a tuple prop like `arg={[3, 'A', 'C', 'B']}`.** Rejected:
it moves the recipe's internal knowledge into the document, which is the
opposite of what recipes are for. Fibonacci and factorial would suddenly
have to accept single-element tuples. The recipe abstraction disappears.

**Add a separate `<HanoiTree>` component.** Rejected: two widgets that
draw the same thing (a recursion tree) would diverge. The colour strategy
and the label template are the only differences; both are legitimately
per-recipe configuration on a single component.

**Deduplicate the tree** (draw hanoi as a DAG when tuples repeat).
Rejected: the tree that the JVM actually executes IS a tree, not a DAG.
Turning it into a DAG would lie about how the recursion actually runs and
would obscure why the algorithm is exponential in the first place (which
is that every leaf-to-root path is $$O(N)$$ but the number of paths is
$$O(2^N)$$).

**Show `aux` in the label** (`hanoi(2, A → B, aux: C)`). Rejected on
Miguel's call — the label gets wider than a chip should be, and the
pedagogical distinction the label is meant to carry (this is a DIFFERENT
call from that one) reads from `n` and `from → to` already. Aux appears
if the reader hovers or inspects, but not on the chip.

## Consequences

**API-compatible for existing recipes.** `fib` and `factorial` render
byte-identical to before: same colours, same labels, same tree. The
existing 8 tests stay green without changes.

**Recipe surface grows by four properties.** Every recipe now declares
`format`, `seed`, `children`, `colorStrategy` — up from `label` and
`children`. Adding a fourth recipe (e.g. mergesort's binary tree) is a
code change of the same shape as before: fill in the four fields.

**The node cap (300 nodes) covers hanoi comfortably.** hanoi(8) is 511
nodes, above the cap; hanoi(7) is 255, below. The pedagogical range
Miguel wants (arg={3} for the slide, arg={4} in catalog examples) fits
comfortably.

**Footer text becomes recipe-specific.** Fibonacci/factorial keep the
existing footer about shared colour. Hanoi carries a different message
(the intrinsic-work argument). Future recipes may add their own; the
default remains the by-arg message.

**Adding a "custom" recipe (author-supplied trace) is still future
work.** The multi-arg change is orthogonal to that — an author-supplied
recipe would fill in the same four properties on a new named recipe.

**Test coverage extended for hanoi.** Three new cases assert the
4-argument label, the child arrangement of hanoi(2), and the
recipe-specific footer. The pre-existing tests for fib/factorial did not
need changes because the API stayed the same for numeric recipes.

**No package.json change.** All extension work is in the widget's own
source file and its catalog/test files.
