# ADR-0044: `<Benchmark>` as the stopwatch-fails widget for Complejidad

**Status:** Accepted
**Date:** 2026-08-20
**Decision-makers:** Miguel Rodriguez
**Covers:** the `<Benchmark>` course-content component · the wire protocol between it and every implementation it runs · why the runtime timer lives inside the JVM rather than around `await run(...)` in JS · the lazy boundary the component sits behind · the timeout branch
**Source:** Issue #218, approved in refinement 2026-08-20 as slice S1 of the "Complejidad · De Hilbert al Big O" document — Act 3 opens with the reader running three implementations of `suma(N)` on their own machine and seeing that the numbers disagree with the professor's, which is the whole reason a stopwatch is not enough.

## Context

The first class of the Complejidad trilogy opens with the argument that a
stopwatch does not compare algorithms — it compares laptops. The argument only
lands if the reader experiences it: everyone runs the same three
implementations of `suma(N)` on their own machine, and the tables disagree. The
professor cannot make that case with slides alone.

The three implementations are `sumaDobleCiclo` (`O(N²)`), `sumaCiclo` (`O(N)`)
and `sumaFormula` (`O(1)`); at `N = 10⁶` they diverge across orders of
magnitude, which is exactly what makes the differences legible on any laptop.
The audience is running Nalanda in a browser tab; running the code anywhere
else is a friction the class cannot afford in the 3–5 minutes the exercise
gets in class. So the timing loop has to happen in the browser, on top of the
platform's existing Java runtime (CheerpJ, ADR-0017).

There is no widget for this today. `<CodeEditor>` runs a single snippet;
`<Exercise>` verifies a student's method against a harness; `<PredictOutput>`
runs a program once and shows what it printed. None of them runs several
implementations, times each one, aggregates the timings and presents them side
by side.

## Decision

**1. Adopt `<Benchmark>` as a new course-content component.** Documents write
`<Benchmark implementations={[…]} inputs={[…]} />`; the widget loads the runtime
on demand, compiles and runs each implementation with the reader-chosen `N` on
stdin, and paints a table of median / min / max per implementation. Same
authoring shape as `<CodeEditor>`, `<Exercise>`, `<PredictOutput>` and
`<Mermaid>`: a component in the shell's MDX map, a catalog entry beside it,
and its lazy wrapper so the runtime stays out of the entry chunk.

**2. Lazy-loaded, no per-document opt-in.** Registered in
`app/mdxComponents.ts` behind `Suspense` as `Benchmark: LazyBenchmark`,
exactly like `LazyCodeEditor`, `LazyExercise`, `LazyPredictOutput` and
`LazyMermaid`. Every reader of every document pays for what the MDX map itself
contains and nothing more — CheerpJ, CodeMirror and the timing logic only
enter the page once `<Benchmark>` is actually mounted, and only for that
reader. Guarded in `apps/web/src/architecture.test.ts` by the same shape as
the other heavy components: a per-name case that forbids anyone but the lazy
wrapper from importing the component module, plus the eager-graph walk that
keeps the runtime out of the packages the browser evaluates before the first
render.

**3. The timer lives INSIDE the JVM, not around `await run(...)`.** Each
implementation reads `N` from stdin, brackets its algorithm with two
`System.nanoTime()` calls, and prints `time_ns:<ns>` on a line of its own; the
widget parses that line and does not measure anything itself. Two forces push
in the same direction:

- **Pedagogical honesty.** This class opens with the argument that
  `System.nanoTime()` is the tool that does not measure the algorithm. The
  widget is the demonstration. Putting the timer around `await run(...)` in
  JS would fold the whole "compile → post to worker → execute → post back"
  round-trip into every measurement, which is not what the class is about.
  With `nanoTime()` inside the algorithm, the reader sees exactly the number
  the slides talk about, and the disagreement across laptops is the algorithm
  plus its host runtime — not the widget's plumbing.
- **Practical accuracy.** The CheerpJ round-trip is dominated by message
  passing to the worker, not by the algorithm. A JS-side timer would report
  ~5–15 ms of overhead even for `sumaFormula` (four operations); the internal
  timer reports single microseconds, which is what the algorithm actually
  costs.

The wire protocol is one string constant (`time_ns:`) shared between the
component and every implementation the catalog and the class ship. The
alternative — a compile-time wrapper the widget writes around each
implementation — is discussed under Alternatives and rejected: it complicates
the author's mental model without buying anything the constant does not.

**4. Fixed presets for `N`, no free slider.** The reader picks from a small
set of preset values (default `[100, 10⁴, 10⁶, 10⁷]`); presets are configurable
per instance. The alternative — a slider with a max cap — invites values that
freeze the tab, and CheerpJ has no worker in this platform (ADR-0017), so the
freeze is total and needs a reload. Presets pick the values that show the
divergence without inviting the trap. Miguel's rule at refinement:
"configurables, pero fijos".

**5. Timeout is a courtesy, not a guarantee.** Each measured run is raced
against a timeout (`timeoutMs`, default 30 000 ms). Exceeded → the row is
marked `TIMEOUT` and the widget continues with the next implementation. Two
things are important to say clearly:

- The Java run cannot be cancelled from JS in this platform (ADR-0017). The
  worker keeps grinding; the widget only frees itself. In practice a
  cuadratic case at `N = 10⁸` will hit the wall, mark TIMEOUT, and any
  subsequent run on the same page inherits a busy worker until the tab is
  reloaded. The class's `N` presets stop at `10⁷` for exactly this reason.
- The widget will not silently pretend a partial measurement is a result. If
  a single measured run times out, the row is marked TIMEOUT — averaging the
  runs that did finish before the wall would fabricate a middle-ground
  number and read on screen as if the algorithm had a real timing.

**6. What the widget shows: median, min, max — nothing else.** The result row
carries three numbers per implementation and a small footer noting how many
runs were measured, how many were warmup, and the timeout. No standard
deviation ("σ", the class does not name variance yet), no ranking, no verdict
about which algorithm is "best". The reader draws the conclusion — the widget
is the evidence.

**7. Uses `<CodeEditor>` (via `LazyCodeEditor`) to render the code, does not
reimplement.** Every listing on the site — every fence in a document, every
snippet in an exercise, every predict-output card — reads as the same editor;
a benchmark widget that painted its own code column in a different font, with
a different highlighter, would read as an alien. Same rule the memory in
`feedback_code_editor_as_widget_base` names.

## Alternatives considered

**Time around `await run(...)` in JS instead of inside the JVM.** Simpler for
the widget (no wire protocol, no per-implementation boilerplate to write the
timer) and does not require the author to remember to bracket the algorithm.
Rejected on the two grounds above: it does not measure the algorithm (folds
in ~5–15 ms of worker round-trip on every run), and it teaches the reader the
wrong lesson (this class opens with the argument that `System.nanoTime()` is
what the reader should be measuring). The extra author boilerplate is one
`main` method with a fixed shape — the same shape every implementation in the
class carries and that the catalog example demonstrates.

**A compile-time wrapper: author writes only the algorithm; widget wraps it in
a generated `main`.** Cleaner ergonomics — the author writes `long suma(int n)
{ ... }` and the widget generates the timer and the stdin read. Rejected:
introduces a hidden Java compilation step the author cannot inspect
(`CodeEditor` would show one thing, `run()` would compile another — same
hazard the `<Exercise>` harness carries deliberately, but there the harness
is the point). It also loses the pedagogical clarity of "this is exactly the
code that runs" — the class needs the reader to see `System.nanoTime()` in the
code, not have it generated behind the curtain. The wire protocol keeps the
author's source honest.

**A slider for N instead of presets.** More exploration, but every value
above the presets' cap risks freezing the tab. Presets pick values that
demonstrate the divergence without inviting the trap. See Decision 4.

**Ranking / verdict / "this one won".** Would flatten the point: no
implementation "wins" absolutely — the sensible choice depends on N. Median /
min / max is the raw evidence and the reader interprets it against the
theoretical curve the class teaches. See Decision 6.

## Consequences

**A fourth heavy component behind the lazy boundary.** The three-line guard in
`apps/web/src/architecture.test.ts` grows one more case (per-name for
`Benchmark`), and the eager-graph walk in the same file catches any static
import that would put CodeMirror or the runtime back in the entry chunk.
Payload cost is comparable to `<PredictOutput>` since it reuses both dependencies.

**A wire protocol authors must respect.** Every implementation must read `N`
from stdin, bracket its algorithm with `System.nanoTime()`, and print
`time_ns:<ns>`. Missing the print reads as a "no se encontró la línea time_ns"
in the result row; writing the wrong constant is caught the same way. The
catalog example demonstrates the shape once; the class's three implementations
inherit it verbatim.

**A widget that will time out on the quadratic case at high N.** By design.
The reader sees TIMEOUT and the class explains why. Higher `N` presets than
`10⁷` are out of scope until Java gets a worker (not on the roadmap;
ADR-0017).

**A new class the suite cannot fully verify.** `<Benchmark>` drives CheerpJ,
which jsdom cannot execute (ADR-0017). The unit tests pin the contract — the
result table, the timeout branch, the wire protocol, the authoring guard,
the stdin payload — with the runtime mocked (same shape as the
`<PredictOutput>` test); the actual timings are confirmed in a real browser at
the WP's S10 browser check. Same rule `apps/web/CLAUDE.md` §"the suite cannot
execute code…" already records for `<CodeEditor>`, `<Exercise>`,
`<PredictOutput>` and `<Mermaid>`.

**No package.json change.** The widget reuses `lucide-react` (already
imported by other widgets) for the play / loader icons, `@uiw/react-codemirror`
through `LazyCodeEditor`, and the runtime through `useLoadedRuntime`. Zero
new dependencies for this widget.
