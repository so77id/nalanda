# ADR-0046: `<MathPlot>` as the math-visualisation widget for Complejidad

**Status:** Accepted
**Date:** 2026-08-20
**Decision-makers:** Miguel Rodriguez
**Covers:** the `<MathPlot>` course-content component · the choice of Mafs as the base library · the `type` prop as the extension surface for future 3D and graph modes · the lazy boundary the component sits behind · what today ships and what is deferred
**Source:** Issue #218, approved in refinement 2026-08-20 as slice S3 of the "Complejidad · De Hilbert al Big O" document — Act 4 draws the orders of growth as a comparison, and the O grande / Ω / Θ definitions carry a reference line drawn as `c · g(N)`.

## Context

The middle of the class needs to draw math functions: `1`, `lg N`, `√N`, `N`,
`N lg N`, `N²`, `2ᴺ` — the orders of growth as one visual comparison — and
later reference lines `c · g(N)` with a marker at `N₀` for the formal
definition of `O(g)` and `Θ(g)`. A static image per plot would work, but the
class returns to the same widget across Acts 4 and 5, and any future class
(Peli 2 for recurrences, Peli 3 for growth rate contrasts) will keep drawing
functions in the same shape.

There is no math-plotting primitive in the repo today. `<Mermaid>` (ADR-0040)
draws diagrams; `<RecursionTree>` draws a tree; `<MemoryVisual>` (ADR-0043)
draws memory frames. None reaches a `y = f(x)` graph, and none should — the
job is genuinely different.

Miguel's rule at refinement (guardado en `feedback_widget_design_own_step`)
also frames the ambition: the widget should be a *component of abstract
mathematical graphs* that can grow into 3D surfaces and node-edge graphs.
Not implemented today, but the surface has to leave room without a
re-design.

## Decision

**1. Adopt `<MathPlot>` as a new course-content component.** Documents write
`<MathPlot type="curves" functions={[...]} xRange={[...]} />` and the widget
paints the curves on a shared coordinate system, with an optional legend,
optional reference lines (annotations), and Mafs's built-in hover
interaction on each curve.

**2. Base library: Mafs.** Small (~30 KB), React-first, KaTeX for labels,
math-visualisation-first API (`Plot.OfX({ y: fn })`, `Coordinates.Cartesian`,
`Line.Segment`, `Text`), theme-aware. Rejected alternatives at refinement:

- **Nivo** — larger ecosystem (includes `@nivo/network` for future graphs),
  but built for dashboards over data points; plotting a continuous function
  requires sampling and reads foreign to math authors.
- **Plotly.js** — universal (2D + 3D + geo + network), but ~3 MB gzipped and
  every render pulls the full stack. The lazy load mitigates a lot, but the
  chunk size is a class of its own.
- **A bespoke SVG renderer** — Full control, zero dependency footprint, but
  every curve becomes a hand-crafted path and every future extension is a
  new implementation. The tax on future authoring is larger than Mafs's
  shipped size.

Miguel's decision at refinement: Mafs for curves now; when 3D or graphs
land, evaluate the best library for that case (Three.js for 3D, Cytoscape.js
or React Flow for graphs) and wrap it behind the same `type` prop.

**3. `type` is a prop, not a component name.** `type="curves"` today.
`type="3d"` and `type="graph"` are reserved for future extensions and reject
the render with a clear authoring error until they land. The alternative
(three components — `<CurvePlot>`, `<Plot3D>`, `<GraphPlot>`) reads three
names in the catalog and duplicates the container chrome (title, legend
placement, theme). One component with three modes names it once.

**4. Lazy-loaded, no per-document opt-in.** Registered in
`app/mdxComponents.ts` behind `Suspense` as `MathPlot: LazyMathPlot`, same
shape as `LazyMermaid`. Every reader of every document pays for what the
MDX map itself contains and nothing more — Mafs only enters the page once
`<MathPlot>` is actually mounted. Guarded in
`apps/web/src/architecture.test.ts` by a per-name case (the boundary the
lazy wrapper protects) and by the eager-graph walk (the invariant nothing
new can regress).

**5. What the widget shows today.** Curves as `y = f(x)`, one or many
overlaid, on a linear coordinate system. Optional title, legend (auto-on for
≥2 functions), and reference lines (vertical or horizontal) with optional
labels. Auto y-range fits to the plotted values with a small padding;
explicit `yRange={[min, max]}` overrides. Colours cycle through a
theme-safe palette; the author picks a named colour with `color: "red"`
if a specific curve needs a specific hue.

**6. What is deferred.** Three items, each documented here so the future
maintainer does not re-derive them:

- **`type="3d"` and `type="graph"`.** Reserved in the prop surface;
  future issues filed alongside #218.
- **`scale="log"` and `scale="loglog"`.** The prop exists so a future
  widget can accept it without a prop rename, but only `"linear"` renders
  today. Log scales require sampling in log space (or a Mafs coordinate
  transform); worth a slice of its own when the class needs it.
- **CodeMirror-integrated legend.** Not on the roadmap; the current
  legend is a plain `<ul>` beneath the plot, which is enough for what
  the class draws.

## Alternatives considered

**Bespoke SVG per plot** — Miguel rejected at refinement: does not scale
to the number of plots the class needs, and reinvents Mafs's math-first
API for every future user.

**Plotly** — Rejected: 3 MB gzipped is more than the whole current site
delta, and the lazy load only masks it.

**Nivo** — Rejected: better ecosystem for the future graph mode, but
worse fit for the today job (function plotting). When graph mode lands,
Nivo's `@nivo/network` is a candidate to evaluate against Cytoscape.js
and React Flow.

**Three components rather than a `type` prop** — Rejected: three names in
the catalog, three sets of container chrome to keep in sync, three
consumers to migrate if the site's tokens move.

## Consequences

**New dependency: `mafs` in `package.json`.** Miguel approved at
refinement (issue #218 body §Widgets); this ADR formalises the decision.
Future math renderers do not need another ADR — they use the surface
this one adopts.

**Another lazy boundary and another architecture-test case.** The
per-name case in `apps/web/src/architecture.test.ts` grows by one entry
(`components/interactive/mathplot`), and the eager-graph walk catches any
static import that would put Mafs back in the entry chunk.

**A new class the suite cannot fully verify.** Mafs renders SVG with a
coordinate transform pipeline jsdom cannot lay out. The unit test pins
what the component DECLARES (the curves it hands the library, the
annotations, the legend visibility, the auto y-range) with the library
replaced by a stub. The paint itself is confirmed in a real browser at
S10.

**A reserved prop surface that fails gracefully.** `type="3d"` and
`type="graph"` today render an authoring error. When they land, the
author's document upgrades without changing the prop — the error branch
becomes a real render.
