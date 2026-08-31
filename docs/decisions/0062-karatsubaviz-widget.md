# ADR-0062: `<KaratsubaViz>` — the Karatsuba multiplication visualiser

**Status:** Accepted
**Date:** 2026-08-31
**Decision-makers:** Miguel Rodriguez
**Covers:** the introduction of `<KaratsubaViz>`, the widget that makes the
Karatsuba algebraic trick visible on concrete integer inputs · the choice
to visualise ONLY the outermost level of the recursion (the three
subproducts appear as concrete values, not as recursive sub-widgets) · the
"reveal panel" layout that grows one row at a time (split → naive
expansion → pivot → three products → middle → reconstruction → answer)
**Source:** Issue #266 — Course document "Diseño de Algoritmos · Divide y
Conquista". Block 4 of the deck closes the class with Karatsuba as the
historical harvest of the anecdote planted in Block 1 (Kolmogórov 1960,
Karatsuba refuting the Ω(n²) conjecture in a week). The widget's job is
to make the algebraic trick `(a+b)(c+d) − ac − bd = ad + bc` explicit,
one line at a time, on a concrete pair of integers.

## Context

Karatsuba is the last D&C example in the class. Unlike the earlier
examples (binary search, máximo, max-subarray, closest-pair), it does
not operate on an array or a plane — its input is two integers and its
combine step is algebraic. What makes Karatsuba pedagogically distinct
is that the *reason* it beats the O(n²) naive multiplication is
algebraic, not structural: writing out `(a+b)(c+d)` and observing that
we already have `ac` and `bd` from the other two products.

The widget has to make that algebraic observation land. Two shapes were
considered:

- **Recursive visualisation.** Show the tree of sub-multiplications
  (3T(n/2) is a ternary tree — 3 subproducts, each recursing on n/2
  digits). For 4-digit inputs the tree has depth 2 and 12 leaves; for
  6-digit inputs depth 2-3 and ~40 leaves. The recursion is the source
  of the O(n^log_2 3) closed form, so this shape has genuine pedagogical
  value.
- **Outer-level only.** Show one Karatsuba call with the three
  subproducts as concrete integers. The recursion is left abstract — the
  reader trusts that P1, P2, P3 are also Karatsuba calls, and the
  abstract recurrence tree lives in `<RecursionTreeDivide
  recipe="karatsuba">` beside this widget in the deck.

Miguel chose the outer-level shape: the widget's pedagogical target is
the ALGEBRAIC TRICK, not the recursion. The recursion is what
`<RecursionTreeDivide>` shows, and putting a full recursive
visualisation here would fight for the reader's attention with the
algebra that this widget alone can make visible.

## Decision

**1. Outer-level Karatsuba only.** The pure engine
`tracesKaratsuba(x, y)` splits `x` and `y` at m = ⌈n/2⌉ where n is the
digit-count of the longer input, computes the three products P1, P2, P3
directly as integers (using JS number multiplication — no recursion),
derives `middle = P3 − P1 − P2`, and reconstructs `x·y`. No sub-widget,
no recursion tree, no sub-trace.

**2. Reveal-panel layout.** No array of cells, no 2D SVG plane. The
widget's body is a series of text rows grouped into five sections:
`Split`, `Escolar (4 productos)`, `Karatsuba (3 productos + álgebra)`,
`Reconstrucción`, `Resultado`. Rows appear one per step; sections are
visually grouped in bordered panels.

**3. Fifteen steps in a fixed pedagogical order.**

- intro
- split (m and pow10m; split x; split y)
- naive expand (formula; four-product expansion; O(n²) observation)
- pivot ("Karatsuba: 3 products + algebra")
- p1, p2, p3 (each with concrete arithmetic)
- middle formula (algebraic derivation) + middle compute (concrete)
- reconstruct formula + reconstruct compute (both stages)
- winner (final answer with check)

That order is exactly the way Miguel wants to teach it: naïve first,
then the pivot, then the three products, then the algebra, then the
reconstruction. The reader who reads only the reveal panel walks the
same story a whiteboard would give them.

**4. The Java code panel shows the recursive Karatsuba.** The code
lists the classical recursive shape with base case at n ≤ 1. This is
what the reader needs to see: how the trick maps to a real
implementation, and where the recursion sits (calls to `karatsuba(...,
n-m)` on lines 7-9). The trace does not walk that recursion — the
active line jumps between the outer-level operations to guide the eye.

**5. `x` and `y` are positive integers, any length up to ~6 digits.**
The trace step count is fixed at ~15 regardless of digit length — the
widget doesn't recurse. Very small inputs (n=1) short-circuit to a
base-case trace.

**6. Same lazy-composition shape as the other D&C widgets.** Composes
`<CodeStepper>` for the code panel; registered through
`lazyKaratsubaViz.tsx`; per-name architecture-test guard.

## Alternatives considered

**Recursive visualisation of the whole tree.** Rejected on Miguel's
call. Two reasons: (a) `<RecursionTreeDivide recipe="karatsuba">`
already shows the recursion abstractly, and (b) the widget's job is the
algebra, which the recursion would drown out.

**A single "before / after" panel comparing 4 products to 3.** Rejected:
the pivot moment — the reader watching the algebra derive `middle = ad +
bc` — is where the pedagogy lands. A before/after view collapses that
moment into a static comparison.

**Author-supplied code listing.** Rejected — same reasoning as
`<BinarySearchOnArray>` (ADR-0059): the narration is tied to specific
line numbers, and pinning them to an author-supplied listing weakens the
contract more than it helps.

**Symbolic-only trace (no concrete integers).** Rejected: the deck's
pedagogical rule is to show the CONSTRUCTION, not only the formula
(`feedback_show_construction_not_just_result` from Miguel). Concrete
numbers on every row make the algebra verifiable by the reader with a
calculator.

**Longer inputs (10+ digits).** Allowed but not planned. The step count
does not grow, and the widget's paint is fine at any digit length; the
deck defaults to 4-digit factors because they read comfortably on a
slide.

## Consequences

**Widget count for issue #266.** Fifth and last new widget; five ADRs
(0058-0062). Same shape as the four before it: `.tsx`, `.test.tsx`,
`.catalog.tsx`, `lazy*.tsx`, this ADR.

**Reader payload.** Pulls CodeMirror + java grammar the first time a
page mounts it — same shared cost as the sibling widgets.

**Trace shape is fixed at ~15 steps.** Because the widget does not
recurse, the trace count is independent of input size. This makes the
widget the cheapest and quickest to walk through of the five, matching
its role as the closing note of the deck.

**Test coverage.** Three groups:
- The pure engine (`tracesKaratsuba`): the classical example
  `1234·5678 = 7006652` including the concrete P1/P2/P3/middle values;
  different-length input padding; small-input base case; step-kind
  ordering.
- Interactive behaviour: initial state; reveal grows per click; final
  answer announced; the three products present after enough clicks.
- Authoring errors: missing `x`/`y`; non-positive-integer inputs.

**Historical care.** The narration explicitly attributes the trick to
Karatsuba's 1960 refutation of Kolmogórov's conjecture (matches the
Block 1 anecdote of the deck). This is the harvest of that anecdote —
same wording matters (see `project_shipped_2026_08_27_batch` and the
Karatsuba anecdote's care in the WP body).

**No package.json change.** Widget lives in
`apps/web/src/components/interactive/`; no new dependency.
