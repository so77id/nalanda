# ADR-0061: `<ClosestPairViz>` — the geometric D&C visualiser

**Status:** Accepted
**Date:** 2026-08-31
**Decision-makers:** Miguel Rodriguez
**Covers:** the introduction of `<ClosestPairViz>`, the widget that traces
the divide-and-conquer closest-pair algorithm on a 2D plane · the choice
of a 2D SVG plane rather than an array of cells (this is the first
geometric widget in the deck) · the full-recursion trace including the
strip-of-width-`d` sweep · the display of the euclidean distance to two
decimals on every step · the dividing-line and strip visuals as the
distinctive pedagogical signals
**Source:** Issue #266 — Course document "Diseño de Algoritmos · Divide y
Conquista". Block 2 of the deck introduces closest-pair as the fourth
D&C example, escalating the combine complexity from linear (max-subarray)
to a geometric strip sweep. The widget must make the strip-of-width-`d`
and the 7-position sweep visible — those are the two mechanisms that
keep the closed form at Θ(n log n) despite operating on a 2D input.

## Context

Closest-pair is the class's most geometric D&C example. Unlike the three
previous widgets (binary-search, max-array, max-subarray), which all
paint an array of cells, this one paints points in a 2D plane. Two
mechanisms are pedagogically load-bearing:

1. **The dividing line.** The algorithm splits the point set at the
   median x, recurses on each half, and gets back the best pair inside
   each half. That much reads as "same as max-subarray, geometric
   version". But it misses the pairs that cross the line.
2. **The strip.** The clever step is that any cross-halves pair with
   distance smaller than `d = min(dL, dR)` must sit within `d` of the
   median x. So we build a "strip" — the sub-set of points whose x is
   within `d` of the median — sort it by y, and check each strip point
   against the next seven. The 7-neighbours bound is what keeps the sweep
   `O(n)`; it is a geometric fact that would take a slide of its own to
   prove and which the deck states rather than proves.

A widget that only paints the winner would erase both mechanisms. The
widget's whole job is to make them visible: the dividing line as a
dashed vertical, the strip as a translucent band, and the currently-tested
pair as a dashed line between two points with the distance labelled.

## Decision

**1. 2D SVG plane, ~480×260px.** The plane paints all input points as
circles with their index labels; the plane's viewBox auto-scales to fit
whatever coordinates the author gives. The widget lives in the same
`interactive/` family as the array widgets — the family covers "the
algorithm running on real data", and a 2D plane is one shape it can take.

**2. Full recursion trace, same shape as `<MaxSubarrayViz>`.** A pure
function `tracesClosestPair(points)` emits one step per meaningful moment:
enter, brute-force pair (base case), return-left, return-right, combine
(`d = min(dL, dR)`), strip-init, strip-sweep (one per pair examined),
winner. Every step carries the call path so the breadcrumb can show
depth.

**3. Euclidean distance to two decimals is on the SVG.** Every step that
tests a pair shows the distance as a small text label near the midpoint
of the dashed line; the winner step shows `d = X.XX` prominently.
Miguel's call: numeric feedback needs to be right there on the plane,
not just in the narration panel below.

**4. Points are sorted internally by x.** The author writes points in
any order (typical MDX authoring style); the widget sorts them by x
before running the recursion. All trace step indices refer to the
sorted-by-x order, and that ordering is exposed on `trace.sortedPoints`
so the widget paints from the same canonical shape.

**5. Base case at `|P| ≤ 3`.** For 2 or 3 points, brute-force all
pairs. This matches the classical Preparata-Shamos statement and is
what the code panel shows. For point sets that are a power of 2 (the
deck's default 8 points), the base case is always exactly 2 points,
which is easiest to teach.

**6. Same lazy-composition shape as the other D&C widgets.** Composes
`<CodeStepper>` for the code panel; registered through
`lazyClosestPairViz.tsx`; per-name architecture-test guard.

**7. Trace budget of 300 steps.** For the pedagogical case (8 points)
the trace is about 40 steps. A collinear input of 64 points blows the
cap — the widget refuses with an authoring error.

**8. Points can share y coordinates without breaking the sort.** The
sort tie-breaks by y after x, so two points with the same x are still
totally ordered; the algorithm's `< d` strip test is a strict
inequality so a coincident-x pair on either side of the dividing line
would still be tested during the sweep (this is a corner case the deck
does not exercise, but the widget handles it correctly rather than
silently missing pairs).

## Alternatives considered

**Only the top-level call (option A).** Rejected on Miguel's call —
same reasoning as `<MaxSubarrayViz>`. Collapsing the widget to a
top-level "here's a strip" demo would hide the recursion, and per
ADR-0063 closest-pair does not get a companion recursion-tree widget
in the deck — the recursion IS what this widget carries.

**Manhattan distance.** Rejected on Miguel's call — euclidean is what
every algorithms textbook uses, and the algorithm's correctness bound
(the "at most 7 neighbours" fact) is specifically euclidean.

**Show more decimals than two.** Rejected — two decimals is enough to
compare distances on this plane and is the granularity the reader can
sanity-check mentally; more decimals would overwhelm the SVG with
digits.

**A canvas or WebGL plane.** Rejected — SVG paints crisp text and lines,
works with the existing token-based colour system, and its DOM is
inspectable in the browser dev tools. The point counts we deal with
(≤ 8) are trivially cheap in SVG.

**Emit one step per full strip sweep instead of one per pair examined.**
Rejected: the pair-by-pair sweep is exactly what makes the O(n) cost
visible. Collapsing it hides the "7 neighbours per point" mechanism.

## Consequences

**Widget count for issue #266.** Fourth of five new widgets; five ADRs,
0059-0063 (ADR-0058 for `<RecursionTreeDivide>` was authored during S1
and deleted mid-branch — see ADR-0063 §7). Same shape as the two D&C
widgets before it: `.tsx`,
`.test.tsx`, `.catalog.tsx`, `lazy*.tsx`, this ADR.

**Reader payload.** Pulls CodeMirror + java grammar the first time a
page mounts it. The SVG itself is inline, no library — the shape is
paint code, not diagramming.

**Trace budget.** 8 points → ~40 steps; the pedagogical range (4-8
points) fits well inside the 300 cap. Collinear 64-point input
overflows.

**Test coverage.** Three groups:
- The pure engine: brute-force correctness for `|P|≤3`; straddling-line
  correctness (the strip is what finds the closest pair); full-trace
  shape; call-path exposed on every step.
- Interactive behaviour: SVG plane and code panel present; every input
  point drawn; step advance changes depth; winner announced with the
  euclidean distance to two decimals.
- Authoring errors: missing / too-small `points`; input over the safety
  cap.

Colour and the theme-keyed active-line paint stay the S7 browser check's
job.

**No package.json change.** No new dependency; SVG is native, and
lucide-react + CodeMirror already ship for the sibling widgets.
