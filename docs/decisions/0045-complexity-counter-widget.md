# ADR-0045: `<ComplexityCounter>` as the count-operations widget for Complejidad

**Status:** Accepted
**Date:** 2026-08-20
**Decision-makers:** Miguel Rodriguez
**Covers:** the `<ComplexityCounter>` course-content component · the declarative breakdown authoring surface · the three modes (base / cases / space) · the choice not to parse the code · the choice not to integrate a CodeMirror gutter for now
**Source:** Issue #218, approved in refinement 2026-08-20 as slice S2 of the "Complejidad · De Hilbert al Big O" document — Act 4 opens with counting operations in the three implementations of `suma(N)`, and Act 5 uses the same widget in `cases` mode over `FindInArray`.

## Context

The middle third of the class turns on counting operations by hand — line by
line, one row per line — and reading the sum as `T(n)`. In slides alone this
reads as static tables: "line 1 costs 1 OE, runs 1 time; line 2 costs 2 OE,
runs n times; total 4n + 4". Static tables are exactly what a slider makes
visible: move `n` from 10 to 100 and the reader sees `n` grow, the row-by-row
executions grow with it, and `T(n) = 4n + 4` stay identical because the closed
form is a property of the algorithm rather than of the input.

There is no widget for this today. `<CodeEditor>` runs a snippet;
`<Exercise>` verifies against a harness; `<PredictOutput>` runs once and
reveals; `<Benchmark>` (ADR-0044) measures. None counts.

The class calls for the same widget three times in three shapes:

- **Base**: a single algorithm with one breakdown and one closed form
  (the three implementations of `suma(N)` in Act 4).
- **Cases**: three tabs (mejor / peor / promedio), each with its own
  breakdown and closed form, over the same code (FindInArray in Act 5 —
  the three cases are qualitatively different: Θ(1) vs Θ(n) vs Θ(n)).
- **Space**: same shape as base but the counted unit is memory cells and
  the total is `M(n)` rather than `T(n)` (Act 5 space section).

## Decision

**1. Adopt `<ComplexityCounter>` as a new course-content component.**
Documents write `<ComplexityCounter algorithm="..." data={{ breakdown, formula,
evaluate }} slider={...} />` and the widget renders a three-column table (code,
OE per execution, executions), followed by the closed-form `T(n) = ...` and its
evaluation at the slider's current value.

**2. The breakdown is DECLARATIVE — the widget does not parse the code.** The
author lists the rows explicitly: one row per line, each with the number of
OE it costs per execution and a formula for how many times it runs. Miguel
rejected the "widget parses Java and counts on its own" alternative at
refinement: a parser would be silently wrong on edge cases (`i++` vs `++i`,
short-circuit boolean, `Math.max` calls) and hiding the counting model
inside JS would defeat the pedagogical point (the reader is meant to SEE the
counting, not trust a machine that already did it). The author's judgment is
the model — the widget just renders it and evaluates.

**3. Three modes, one component, selected by a prop.**
- `mode="base"` (default): one case, single breakdown + formula.
- `mode="cases"`: three tabs (mejor / peor / promedio), each carrying its
  own breakdown and formula; the reader clicks between them.
- `mode="space"`: base layout, but the unit column is "celdas de memoria"
  and the closed form is `M(n)` rather than `T(n)`.

Three components would have duplicated the same evaluation loop, the same
slider, the same LaTeX-ish formula display; one component with three modes
keeps the surface small and lets the class use "the counter widget" as one
name across five acts.

**4. Evaluation is a JS callback, not a formula parser.** The author
declares `evaluate: (n) => 4*n + 4` beside `formula: "4n + 4"`. The widget
uses `formula` for display and `evaluate` for the numeric substitution;
they are never derived from each other. A parser would be another silent
source of divergence — an author who types `formula: "4n + 4"` but
`evaluate: (n) => 3*n + 4` gets a legible bug (`T(n) = 4n + 4 · Para N = 10
→ T = 34`) rather than the illusion of consistency.

**5. The executions column shows BOTH the symbolic formula and its
evaluated value.** `n+1 = 101` for n = 100. The symbolic form is the
mechanism the reader is learning; the evaluated form ties it to a concrete
number so the slider has something to move. Miguel's rule at refinement:
"both, always — the formula alone reads as abstract and the number alone
loses the reasoning".

**6. `for` headers collapse their sub-parts under a chevron.** A `for (int
i = 1; i <= n; i++)` is one line of code but three sub-counts (init, cond,
inc). Rendering all three inline would triple the row height of every for
in the class; hiding them entirely would lose the mechanism. Collapsed by
default with a chevron that expands to the three sub-rows on click keeps
the table quiet in normal reading and available in-depth on inspection.

**7. The gutter is a table alignment for now, not a CodeMirror
integration.** The refinement discussed an integrated CodeMirror right
gutter (via decorations) so the annotations sit inline with the code in
its own font, colours and theme. That path is real (CodeMirror 6 exposes
line decorations) but is more invasive than this slice can carry: the
integration point is inside `<CodeEditor>`'s internals, not the wrapper
surface, and it interacts with the existing gutter plumbing (line
numbers, breakpoints). This ADR accepts a **line-by-line table** (with
code column rendered as `<code>` in the font-mono class the site uses
elsewhere) as the shipping version, and files a future issue to move to
the CodeMirror-integrated gutter later without changing the component's
prop surface. Miguel's rule about widget design in its own step
(`feedback_widget_design_own_step`) applies: the visual integration is
worth its own slice, not a shortcut inside this one.

## Alternatives considered

**Automatic parser — the widget reads the code and counts.** Rejected: the
parser must be right about Java (`i++` in the increment slot vs as an
expression, `System.out.println` as one OE or three, `Math.pow` as
constant or as its implementation) and every disagreement between the
parser and the professor is a silent lie. A declarative breakdown puts
the professor in charge of the counting model — which is what the class
teaches.

**Three separate components (Counter / Cases / Space).** Rejected: they
would share the slider, the evaluation and the display; three
implementations diverge; the "counter widget" would be three names in the
catalog. A single component with a `mode` prop names it once.

**CodeMirror-integrated gutter from day one.** Rejected: it is real and
worthwhile, but its integration touches `<CodeEditor>` internals and needs
its own design pass (per `feedback_widget_design_own_step`). Filed as a
future issue; the shipping version renders the code as a table row —
same font, same colour tokens as everywhere else, no fancy highlighting.

**Formula parser instead of an explicit `evaluate`.** Rejected: a parser
that accepts `4n + 4` and `n*(n+1)/2` and `Math.log2(n)` and rejects the
typos accurately is a lot of code, and the ROI is negative because the
author already thinks in JS when composing the algorithm. The catalog
example demonstrates the shape once; every use in the class inherits it.

## Consequences

**Another lazy-loaded component behind Suspense.** Even though the widget
does not drive the runtime or wrap CodeMirror directly, it is registered
lazily to keep the pattern consistent and to leave room for the CodeMirror
gutter future extension without an entry-chunk regression.

**Author writes a declarative breakdown once per algorithm.** The catalog
carries the shape and the class inherits it verbatim. Boilerplate is one
row per code line, all in an object literal — no hidden state, no side
effects, testable by inspection.

**Formula and evaluator can diverge.** Deliberately visible: an author who
declares `formula: "4n + 4"` but `evaluate: (n) => 3*n + 4` sees the
divergence in the widget's own output (`T(n) = 4n + 4 · Para N = 10 → T =
34`) rather than a lie. A single-source-of-truth parser would hide the
divergence by making one impossible; the class already lives with the
same trade-off between "the tests verify what the code does" and "the
code IS what the tests verify".

**A future upgrade path.** The CodeMirror-integrated gutter (§7 of the
Decision) sits behind the same prop surface — a version bump ships better
visuals without touching any authored breakdown in the course. Filed as
a follow-up issue in the Future work of #218.

**No package.json change.** The widget uses `lucide-react` (already
present) for the chevrons, and standard React for state and layout.
