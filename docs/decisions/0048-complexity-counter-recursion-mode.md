# ADR-0048: `<ComplexityCounter mode="recursion">` for analyzing recursive algorithms

**Status:** Accepted
**Date:** 2026-08-26
**Decision-makers:** Miguel Rodriguez
**Covers:** the fourth mode of the existing `<ComplexityCounter>` (ADR-0045) · the shape of the recursion-mode authoring surface (`recurrence`, `base`, `unroll`, `closedForm`, per-line `note`) · the decision to render everything declaratively (no parsing, no solving)
**Source:** Issue #221 — "Complejidad · *Recursión y memoria*". The naive-Fibonacci analysis in Act 3 and the memoized-fib analysis in Act 4 both need a widget that makes a recurrence, its unroll, and its closed form legible next to the code that produced them; the class calls the widget by name twice (slides 14 and 21).

## Context

Peli 1 (#218) shipped `<ComplexityCounter>` (ADR-0045) with three modes and, at
its 2026-08-25 amendment, a fourth `abstract` mode. All four modes assume the
same shape of analysis: **the cost per line, multiplied by the number of times
it runs, summed into a closed form as a function of `n`**. That model works for
iterative code, where each line has a natural OE and each loop provides a
plain `times` formula the widget can substitute the slider into.

Peli 2 (#221) analyses **recursive** algorithms. A recursion has no
line-by-line multiplicative model — the cost of `fib(n)` is not something you
sum from the two lines of the body, it is the recurrence
`T(n) = T(n-1) + T(n-2) + c` that they induce. The reader has to see that:

- the code is on the left, still, so the recurrence is grounded in the
  source that produced it;
- the recurrence itself sits in its own space, as a mathematical object;
- the unroll — the step-by-step substitution that reduces the recurrence to
  a closed form — is a sequence of formulas, not a table with a slider;
- the closed form (`T(n) = Θ(φⁿ)` for naive fib) is emphasised, because it is
  the conclusion of the analysis.

The same widget is called by name twice in the class — Miguel's rule that a
mode is worth adding once the class calls the widget more than once (per
ADR-0045 §Decision item 3) applies. A separate `<RecurrenceCounter>` widget
would have shared everything but the panels — the code editor, the rail, the
authoring gate, the lazy boundary, the catalog entry — and would have grown a
third name in the "counter widget" family for the same reason ADR-0045
rejected splitting the first three modes.

## Decision

**1. Fourth mode of `<ComplexityCounter>`, not a new widget.** Documents write
`<ComplexityCounter mode="recursion" code="..." data={{ ... }} />`. The
`data` shape gains four required fields — `recurrence`, `base`, `unroll`,
`closedForm` — and the annotation shape gains an optional `note` field. The
existing `mode` union grows one member; the existing modes stay
byte-identical.

**2. The recurrence, its base cases, the unroll and the closed form are
DECLARATIVE — the widget does not solve, parse, or manipulate them.** Same
principle as ADR-0045 §Decision item 2. A "widget that solves the
recurrence" was rejected on the same grounds a "widget that parses the
Java and counts" was rejected there: the class teaches the reader how to
derive the closed form, and a machine that already did it hides the
model. The author writes the recurrence and the intermediate forms
verbatim; the widget renders them.

**3. Three panels, in fixed order.** Below the code + rail, three
`<Panel>`s stacked vertically:

- **Recurrencia** — the recurrence itself (`T(n) = T(n-1) + T(n-2) + c`)
  followed by the base cases (`T(0) = c`, `T(1) = c`), each on its own
  line. Empty `base` is legal — the panel just shows the recurrence.
- **Desarrollo** — an ordered list of unroll steps. Each step is a
  formula plus an optional short Spanish parenthetical
  (`(sustituimos T(n-1))`). No slider, no numeric substitution: the
  reader is looking at the algebra of the reduction, not a value.
- **Forma cerrada** — one line, emphasised (a light accent tint behind a
  bold monospace formula), holding the closed form. It is the punchline
  of the analysis and reads as such.

**4. The rail uses free-form pedagogical notes, not OE × times.** In
recursion mode, `annotations[lineNumber] = { note: "esta llamada aporta
T(n-1)" }`. The rail row shows the code line and the note underneath, and
still lights up on hover from the editor — the pedagogical anchor between
"this line of Java" and "this term in the recurrence" is what the reader
is learning. The four existing per-line fields (`oe`, `times`, `sub`,
`skipped`) are ignored in this mode; `note` is added as an optional field
on `LineAnnotation` for the widget to read here and other modes to ignore.

**5. No slider, no OE panel.** The construction panel of the other modes
prints per-line contributions and evaluates a formula at the slider's
value. A recurrence has no `n`-per-line to substitute — the value is
already algebraic, and the point of the class is the reduction, not a
number. Both the slider strip and the construction panel are dropped in
this mode; the three panels above replace them.

**6. No KaTeX in-widget.** The unroll list renders in the same monospace
font as the rest of the widget's plain-text output (the same style as the
existing construction panel). KaTeX exists on the page (through the MDX
pipeline) but wiring a math renderer inside a widget is its own design
concern — Miguel's rule about widget design in its own step
(`feedback_widget_design_own_step`) applies. If the class wants a
KaTeX-rendered unroll later, it lands as its own slice; the shipping
version prints the algebra as monospace text, same visual language as the
`T(n) = ...` line in the other modes' construction panel.

## Alternatives considered

**A separate `<RecursionAnalysis>` widget.** Rejected for the same reason
ADR-0045 rejected splitting the first three modes: shared code editor,
shared rail infrastructure, shared authoring gate, shared lazy
registration, shared catalog family. A single component with four modes
keeps the "counter widget" name across seven acts (five in Peli 1,
two in Peli 2).

**The widget solves the recurrence.** Rejected on the same grounds as the
"widget parses the code" alternative in ADR-0045: the reader is learning
how to reduce a recurrence, and a machine that already did it defeats the
lesson. Also: the general algorithm (characteristic equation for linear
recurrences with constant coefficients, then Master Theorem, then more
exotic techniques) is not something the widget can hand-wave — an author
who calls it on `T(n) = T(n/2) + f(n)` and gets a wrong answer has a lie
in the class; an author who writes the closed form themselves takes
responsibility for it, and the widget just renders.

**An interactive step-through of the unroll** (slider + node counter).
Rejected at refinement: the pedagogical unit is "here is the step, here
is why it changed"; making the reader click through the substitutions one
by one adds a step nobody asked for and hides the shape of the reduction
that reading top-to-bottom already conveys. Filed as future work under
#221 "Future work" in case the Master Theorem WP finds a use for it.

**KaTeX from day one** (§Decision item 6 above, positive form). Rejected
on the same grounds as ADR-0045 §Decision item 7 rejected the CodeMirror
gutter integration: it is real, it is worth doing, and it is a separate
design pass — the visual integration deserves its own slice.

## Consequences

**One new authoring surface per algorithm.** An author who writes a
recursive analysis fills in `recurrence`, `base`, `unroll`, `closedForm`,
plus per-line `note`s. Same shape as the abstract mode: no side effects,
no hidden state, testable by inspection.

**The prop surface grows by five fields — four on `data`, one on the
annotation.** All optional at the type level; the widget's authoring gate
enforces they are present under `mode="recursion"` and issues an
`AuthoringError` naming the missing field otherwise (per ADR-0045's
authoring-gate discipline).

**No change to the lazy boundary.** The widget is still registered
through `lazyComplexityCounter`; the recursion branch adds no new
imports (uses `Panel`, `CodeStepper`, the existing rail styles) and no
new dependencies.

**Formula and unroll can lie about each other.** Deliberately visible:
an author who declares `closedForm: "T(n) = Θ(n²)"` after an unroll that
ends at a Fibonacci-shaped growth has a legible bug — the panel prints
Θ(n²) below an unroll that clearly does not converge to it. Same
trade-off as ADR-0045 §Decision item 4: the widget does not hide the
divergence by making it impossible.

**A future upgrade path.** A KaTeX-rendered unroll (§Decision item 6)
sits behind the same prop surface — a version bump ships better visuals
without touching any authored analysis in the course. Same shape as the
CodeMirror-gutter upgrade path filed against ADR-0045.

**No package.json change.** The widget uses the same infrastructure it
already ships with. `React`, `Panel`, `CodeStepper`, existing rail
markup, existing accent tokens.
