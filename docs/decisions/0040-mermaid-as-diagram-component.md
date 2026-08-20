# ADR-0040: Mermaid as the diagramming component for course documents

**Status:** Accepted
**Amended by:** #209 (2026-08-19) — the `<MemoryDiagram>` component this ADR
names in §Context, §Decision (as a peer lazy wrapper in Decision-2 and as the
annotated-fence-surface comparator in Decision-4) and §Consequences was
retired by the ADR that supersedes 0028. The lazy-boundary and paint-check
reasoning stays; only that concrete example is historical.
**Date:** 2026-08-18
**Decision-makers:** Miguel Rodriguez
**Covers:** the `<Mermaid>` course-content component · the `mermaid` runtime dependency · how a document renders a class diagram · the entry-chunk boundary the library sits behind
**Source:** Issue #79, approved in refinement 2026-08-18 as the first slice of the "Objetos" document — §7 needs a class diagram to show that polymorphism hangs off both class inheritance and interface implementation, and no drawing pipeline exists.

## Context

The teaching path has run four documents without a diagram (`06-java-desde-cpp`
through `09-arrays-y-funciones`), and it worked: every idea so far compresses to
a code snippet, a memory drawing (`<MemoryDiagram>`, ADR-0028) or a recursion
tree (`<RecursionTree>`, #78). The fifth document is where that runs out. §7 of
"Objetos" teaches **polymorphism as a single dispatch mechanism** that hangs off
both class inheritance (`Vehicle` → `Auto`, `Camion`) and interface
implementation (`Comparable` implemented by `Integer`, `String`, `Fecha`). The
point is the parallel: two independent hierarchies, one runtime, one lesson. In
prose it reads as two lists; in a class diagram it reads as one picture with
two shapes.

There is no drawing pipeline in the repo today. `<MemoryDiagram>` draws its own
listing from an execution trace (ADR-0028) and reaches nothing generic;
`<RecursionTree>` draws a recursion tree with CSS and lucide chevrons and knows
two recipes. Neither reaches a UML-shaped class diagram, and neither should — a
drawing generator per shape does not scale as the course grows into inheritance,
state machines, entity relationships and the graphs `docs/course-graph.md`
already anticipates ("cuando el grafo crezca a +80 nodos y la legibilidad de
Mermaid se…").

The question is what generic drawing surface we adopt now, once, and reuse
through the rest of v0.2 and v0.3.

## Decision

**1. Adopt Mermaid as the platform's diagramming component.** Documents render a
diagram by writing `<Mermaid>` with the diagram source as a prop. The component
loads the `mermaid` library on demand and renders the SVG into the page. It is
authored the same way `<CodeEditor>` and `<PredictOutput>` are: a component in
the shell's MDX map, a catalog entry beside it, and its lazy wrapper so it
stays out of the entry chunk.

**2. Lazy-loaded, no per-document opt-in.** The component is registered in
`app/mdxComponents.ts` behind `Suspense`, exactly like `LazyCodeEditor`,
`LazyExercise`, `LazyMemoryDiagram` and `LazyPredictOutput`. Every reader of
every document pays for what the MDX map itself contains and nothing more —
`mermaid` is not in that map. The library only enters the page once
`<Mermaid>` is actually mounted, and only for that reader. Guarded in
`apps/web/src/architecture.test.ts` by the same shape as the other heavy
components: a per-name case that forbids anyone but the lazy wrapper from
importing the component module, plus the eager-graph walk that keeps `mermaid`
out of the set of packages the browser evaluates before the first render.

**3. The catalog entry lives with the component.** `Mermaid.catalog.tsx` beside
`Mermaid.tsx`, aggregated in `catalogEntries.ts`, following ADR-0010/0014 and
the pattern every other content component already uses. The catalog page runs
the real component (Rule 5, `documentation.md`), so its live snippets stay in
Spanish; the entry prose stays in English.

**4. Authoring surface: source as a prop.** The MDX author writes
`<Mermaid source={\`classDiagram ...\`} />`, not a ```mermaid``` fence.
The two options were both considered:

- **A `mermaid` fence** would compose with the existing `<MdxPre>` fence
  renderer, but that renderer is the shell's `pre` mapping and is wired to
  the runtime seam — a fence in it becomes a read-only code listing, and
  overloading it with a "render as a diagram" branch fights the abstraction.
  `<MemoryDiagram>` had to solve the same problem (ADR-0028 §Decision-2) and
  chose an annotated fence for a different reason (it drives a compiled
  program). A diagram is not a program; a prop is the honest surface.
- **A prop** costs the author one attribute and keeps the shell's fence
  renderer single-purpose. It also lets the component validate the source
  before handing it to the library, and surface an authoring error the same
  way every other content component does (`<AuthoringError>`).

## Alternatives considered

**Hand-written SVG per diagram.** The lowest dependency footprint by a wide
margin — no bytes at all — and the best control over what the reader sees. The
cost is that every future diagram is a hand-crafted SVG, and the audience for
that work is the professor who writes the course. A class diagram, a sequence
diagram, an entity-relationship diagram, a state chart and the eight or ten
concept graphs `course-graph.md` anticipates each become a bespoke drawing —
which is the alternative UI kits from Storybook to Notion to GitHub itself all
rejected in favour of a text-to-diagram library. Rejected: the tax on future
authoring is larger than the library's shipped size, and the library only lands
on pages that actually use it.

**[d2](https://d2lang.com/).** A modern, well-designed text-to-diagram library
with better typography and a nicer scripting surface than Mermaid. Rejected on
two counts. First, d2's browser build is a WASM bundle that today weighs
~1.5MB before gzip against Mermaid's ~600kB gzipped, and the library exposes
its layout engine as a separate module — the delivery story is more work.
Second, d2's syntax is less familiar: the audience for this repo (Miguel, and
whoever contributes to the course) already reads Mermaid because GitHub
renders it inline in issues and PRs, so a Mermaid diagram in a WP body reads
as itself. That familiarity was worth more than d2's polish for a
teaching-material renderer.

**A custom UML renderer.** Take one of the small pure-DOM UML libraries
(`uml-diagrams`, `nomnoml`, or hand-written) and ship the ~50kB minimum.
Rejected: the library covers class diagrams and does not cover the state
charts and sequence diagrams the course will need before v0.3 closes. Ships
the smallest bundle and buys the smallest surface — the same tradeoff as the
hand-written SVG option, one library up.

## Consequences

**Bundle cost.** The `mermaid` package is heavy — it reaches `dagre`, `d3`,
`mdast-util-from-markdown`, `khroma` and a handful of parsers. Measured on the
built tree (S9 of the #79 WP, Playwright request logs; the later
review-fixes commit changed no import lines, so the figure stands at the
tip): a page that mounts
`<Mermaid>` downloads **~196 kB gzipped more than a page without one** — the
mermaid-only chunks (`mermaid.core`, `dagre`, `graphlib`, per-diagram
sub-chunks, `rough`), while `/d/java-desde-cpp` requests zero of them. Part
of the library sits in a chunk shared with other dependencies already on the
first paint, which is why the delta is smaller than the library's raw
footprint. The lazy-load mitigation is what makes this acceptable: no page
that never uses a diagram pays the cost, and a page that uses one pays it
once. The guard in `apps/web/src/architecture.test.ts` (a per-name case
forbidding static imports of the component module outside its lazy wrapper,
PLUS the eager-graph walk over the shell entry) fails the suite if the
boundary opens — the same shape that has held `CodeEditor`, `Exercise`,
`MemoryDiagram` and `PredictOutput` behind the same line since #85 and #122.

**A new class the suite cannot fully verify.** Mermaid renders SVG in the
browser at runtime; jsdom lays nothing out, does not implement the SVG
measurement APIs the layout engine needs, and the library refuses to render
against it. The component's unit test therefore pins **what the component
declares** (the container attributes, the source it hands the library, the
authoring error branch) and the paint itself is confirmed in a real browser at the WP's S9 browser check, in both themes. Same shape as `<RecursionTree>`
(#78, argument identity pinned in jsdom, colour verified in a browser) and
`<MemoryDiagram>` (ADR-0028, the drawing verified in a browser because the
listing is generated from a run).

**The class enumeration in `apps/web/CLAUDE.md` grows.** The document lists
the three classes of behaviour the suite cannot verify — execution, layout,
document-from-another-origin — and `<Mermaid>` sits alongside the layout
class: it needs the browser's SVG layout to produce anything, and the same
"verify in a real browser against the built site" rule applies. Recorded
inline in the component and re-stated in `apps/web/CLAUDE.md` (§the suite
cannot execute code, lay out a page…).

**A new dependency manifest change.** The root `CLAUDE.md` rule against
touching `package.json` without discussion is honoured through the refinement:
Miguel approved Mermaid at issue-refinement time (2026-08-18), and this ADR
formalises that decision. Future diagram needs — sequence diagrams, ERDs, the
course-graph rewrite — do not need another ADR; they use the surface this one
adopts.

**A new third-party render surface, gated at `securityLevel: 'strict'`.** The
library's SVG is injected into the page via `innerHTML`, so strict mode is the
whole defense: it enables mermaid's label escaping and its final DOMPurify
pass over the produced SVG (both verified against the locked 11.16.1), and it
disables click bindings. The setting is pinned by a test — the same shape as
the KaTeX `trust: false` pin — and recorded with its review triggers in
`docs/security-notes.md` (§Accepted invariants).

**The working budget: one diagram per section.** The library parses and
lays out on every mount and the first mount pays the module download, so a
section may carry one diagram; a page that mounts many should trigger the
revisit below rather than grow silently. Mermaid's rendering is not free at runtime: the library
parses the source, runs its layout engine and produces SVG on every mount,
and the first mount pays for the module load too. On the pages the course
uses today (one diagram in one section of one document), that cost is not
worth an optimisation. If a document ends up with many diagrams on the same
page — a v0.3 concept-graph browser is the plausible shape — a
memoisation-per-source or a build-time render would move the cost off the
reader's browser. Not decided here; the trigger is a measurable second-mount
slowness on a real page.
