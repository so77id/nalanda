# ADR-0058: `<RecursionTreeDivide>` — the D&C axis widget

**Status:** Accepted
**Date:** 2026-08-31
**Decision-makers:** Miguel Rodriguez
**Covers:** the introduction of `<RecursionTreeDivide>`, a content component
that draws the recursion tree of a divide-and-conquer algorithm and the
per-level cost rail that carries the "trabajo-por-nivel × número-de-niveles"
argument · the choice of a single component keyed on five NAMED RECIPES
(`binary-search`, `max-array`, `max-subarray`, `closest-pair`, `karatsuba`)
rather than five per-algorithm components · the deliberate decision that this
widget draws only the tree and the cost breakdown, while the per-algorithm
visualizers (`<BinarySearchOnArray>`, `<MaxSubarrayViz>`, `<ClosestPairViz>`,
`<KaratsubaViz>`) live as separate widgets
**Source:** Issue #266 — Course document "Diseño de Algoritmos · Divide y
Conquista". The deck's Block 2 introduces the recursion-tree method as the
microscope for D&C complexity BEFORE the Master Theorem shortcut, and reuses
the same tree drawing in five places (binary search, máximo, max-subarray,
closest-pair, Karatsuba) to make the pattern read as a single technique
applied to different problems.

## Context

Peli 2 (#221) shipped `<RecursionTree>` for the recursive-Fibonacci and
Hanoi case studies. That widget draws a recursion tree keyed on numeric
recipes (`fib`, `factorial`, `hanoi`) where the pedagogical signal is
either **duplicate colouring** (fib) or **uniform colouring** (hanoi,
per ADR-0056), and where each node label is a call like `fib(3)` or
`hanoi(2, A→C)`.

Divide-and-conquer needs a different visualisation because the point of
looking at a D&C tree is not "do subproblems repeat?" (they don't — the
data is partitioned into disjoint halves by construction) but "how does
the total cost break down as work-per-level × number-of-levels?". The
same drawing style would carry the wrong pedagogical signal: colours
that repeat would suggest sharing that isn't there, labels of the form
`f(n=8)` would look like function calls when the point is the recurrence
`T(n) = aT(n/b) + f(n)`.

Two shapes fit this WP's Block 2. Either five per-algorithm widgets
(each drawing "its own" recursion tree with its own visual sugar), or
one widget that knows five recipes and draws them the same way. The
argument for five was that each algorithm could specialize (binary
search is a linear chain, karatsuba is ternary). The argument for one is
that ADR-0056 has already settled this exact question in the sibling
widget — *"two widgets that draw the same thing (a recursion tree)
would diverge"* — and that the pedagogical thread of "the same
microscope, five times, on five different problems" is exactly what a
deliberately shared visual signature carries.

## Decision

**1. One component, five named recipes.** `<RecursionTreeDivide recipe=
"karatsuba" n={16} />`. The author writes the recipe name and the size of
the root problem; the component draws the tree and the cost rail. Adding
a sixth recipe is a code change of the same shape as adding one to
`<RecursionTree>` — fill in `a`, `b`, `f(n)`, and the header string in
the RECIPES table. MDX props do not carry lambdas well.

**2. The tree draws faithfully — one node per subcall.** Binary search
therefore renders as a **linear chain** of `log₂(n)` nodes, because its
recurrence is `1·T(n/2) + O(1)` and only one child is explored per call.
The alternative — drawing two children and shading one out — would
misrepresent the algorithm and the recurrence. The linear chain IS the
pedagogical point: BS has one subproblem per level, `log n` levels, `O(1)`
work each, therefore `O(log n)`. Karatsuba (ternary) and the four binary
recipes render as full trees.

**3. Every node chip carries `T(k)` and, when `f > 0`, `· O(f(k))`
inline.** Base cases render as `T(1)` with a muted, rounded chip; non-base
cases carry the combine cost right on the chip so the reader does not have
to cross-reference the rail to read what each node's work is. In dense
trees (karatsuba(16), 121 nodes) the inline label is short (`T(4)·O(4)`,
`T(2)·O(2)`) and readable; in sparse trees (BS, one node per level) the
label is what the level tells the reader.

**4. Uniform accent hue for every node.** No by-argument colour cycling
(unlike `<RecursionTree>` for fib): D&C's sibling calls are on **different
data** by construction — there is no "same call twice" story to tell with
colour. Uniform paint mirrors the choice ADR-0056 already made for Hanoi's
`colorStrategy: 'uniform'`, for the same reason: no colour-sharing signal
to send.

**5. The cost rail is concrete and numeric, with the closed form Θ(...)
at the foot.** For `<RecursionTreeDivide recipe="max-subarray" n={8}>`
the rail reads:

```
Nivel 0:  1 × O(8) = 8
Nivel 1:  2 × O(4) = 8
Nivel 2:  4 × O(2) = 8
Nivel 3:  8 × O(1) = 8
─────────────────────────
Total:   4 niveles × 8 = Θ(n log n)
```

Concrete numbers put the pattern in view — the reader sees WHERE the
`n log n` comes from — and the closed form at the foot generalises it.
A symbolic-only rail (`a × f(n/b)`) would be less legible in a slide and
would duplicate what the recurrence in the header already says.

**6. Static — no playback controls.** Same convention as
`<RecursionTree>` and the whole Peli 1/2 counter family. If a future WP
needs step-through, add it then.

**7. `n` must be a positive integer, and typically a power of `b`.** For
non-powers of `b`, the tree would have to draw ceil/floor children of
different sizes and the pedagogical point (the same partition size at
every level) blurs. The widget renders an `<AuthoringError>` naming the
recipe's `b` and asking for a power of it, rather than silently drawing
a lopsided tree. This is honest to the standard textbook simplification
of the Master Theorem.

**8. Node cap of 300.** karatsuba(n=32) reaches 364 nodes and is refused
with an `<AuthoringError>`; karatsuba(n=16) at 121 nodes fits, as do the
four binary recipes up to n=64 (127 nodes) and BS up to arbitrarily
large n (one node per level, log₂ n is tiny). The cap prevents an
authoring typo from freezing the tab; the pedagogical range Miguel
plans (max-subarray n=8, closest-pair n=8, karatsuba n=8 or 16) fits
well inside.

## Alternatives considered

**Five per-algorithm components.** Rejected on the same grounds as
`<HanoiTree>` in ADR-0056: the five drawings would diverge on the first
convention change (rail format, colours, layout of the header). More
importantly, the WP's pedagogical narrative *depends* on the shared
visual signature — the reader recognises "ah, the D&C microscope again"
each time the widget appears. Five widgets that look 90% alike weaken
that signal deliberately.

**Fuse tree + per-algorithm visual into one widget per algorithm** (skip
`<RecursionTreeDivide>` entirely; put the recursion tree inside
`<MaxSubarrayViz>` etc). Rejected: the tree and the per-algorithm visual
answer two different questions ("what is the cost breakdown?" vs "what
does the algorithm do on real data?"), the tree is what the reader sees
FIRST in the deck's Block 2 (Master Theorem is derived from staring at
this tree three times), and it is the widget that appears in Karatsuba
where there is no "array" or "plane" to visualise — Karatsuba is
algebraic. A shared tree widget is the only shape that fits all five.

**Author-defined recipes** (`<RecursionTreeDivide a={2} b={2} f="n">`).
Rejected: the five recipes are the pedagogical vocabulary of the class.
Letting an author invent one at authoring time would tempt them to
declare recurrences the class does not teach and would break the "adding
a recipe is a code change" contract that keeps the widget tested. If a
future class needs a sixth recipe, adding it is one commit to
`RECIPES`.

**Interactive expand/collapse** (start closed, click to reveal). Rejected
for the same reason `<RecursionTree>` reversed that decision at Miguel's
review: on a slide the reader gets more from SEEING the shape all at
once than from clicking through it, and a closed tree reads as broken.
The tree opens fully. (Adding a "collapse this subtree" click later is
still cheap, if it turns out to be wanted.)

**Symbolic-only rail** (`a · f(n/b)` per row instead of concrete
numbers). Rejected: the recurrence in the header already carries the
symbolic form. Repeating it in the rail duplicates without adding, and
loses the "the reader can DO the arithmetic" property that concrete
numbers deliver.

## Consequences

**Widget count for issue #266.** This ADR ships one widget with five
recipes. Issue #266 also ships four per-algorithm visualizers as
separate widgets (S2–S5, each with its own ADR). Total: five new widgets,
five new ADRs (0058–0062).

**Reader payload.** The widget is a small SVG-free component (JSX chips
with per-level layout, no dependency beyond React and lucide icons)
following the same lightweight shape as `<RecursionTree>`. Not lazy: no
CodeMirror, no runtime seam, no Nivo — the eager-graph walk in
`src/architecture.test.ts` stays green when it is added to `mdxComponents`.

**Test coverage.** Per-recipe cases assert: the header text carries the
recurrence, the root chip carries `T(n)`, the tree depth matches
`log_b(n) + 1`, the base-case chip variant appears at the leaves, the
cost rail has one row per level and the closed form Θ(...) at the foot,
non-power `n` is refused, and the node cap refuses karatsuba(32). Colour
is not asserted (jsdom paints nothing) — a `data-recipe` attribute pins
the identity of what the theme-keyed paint is derived from, and the S7
browser check confirms the actual paint in both themes.

**Cross-widget guard.** `<RecursionTreeDivide>` and the per-algorithm
visualizers share a slide together in three places (BS, max-subarray,
closest-pair, karatsuba). The tree widget is `not-prose` and wraps in
`overflow-x-auto`; the tall karatsuba(16) tree may need `SLIDE_BUDGET_VH`
capping — verified in the S7 browser check.

**No package.json change.** Widget lives entirely in
`apps/web/src/components/interactive/`; no new dependency.
