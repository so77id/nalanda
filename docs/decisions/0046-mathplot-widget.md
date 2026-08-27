# ADR-0046: `<MathPlot>` as the math-visualisation widget for Complejidad

**Status:** Accepted
**Date:** 2026-08-20
**Amended:** 2026-08-25 — library switched from Mafs to Nivo; embedded-mode fixed-size `<Line>` for `<SideBySide>` documented as a Consequence; y-clip behaviour for fixed `yRange` documented.
**Decision-makers:** Miguel Rodriguez
**Covers:** the `<MathPlot>` course-content component · the choice of Nivo as the base library · the `type` prop as the extension surface for future 3D and graph modes · the lazy boundary the component sits behind · what today ships and what is deferred
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
draws diagrams; `<RecursionTree>` draws a tree; `<MemoryVisual>` (ADR-0049)
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
optional reference lines (annotations), and Nivo's built-in tooltip / hover
interaction on each curve.

**2. Base library: Nivo (`@nivo/line`).** React-first line-chart component,
theme-friendly, exposes both a `<ResponsiveLine>` (auto-sized to the parent)
and a fixed-size `<Line>` — the fixed-size variant is what the widget uses in
presentation mode to sidestep Nivo's `ResizeObserver`-based sizing under CSS
`transform: scale(...)`, which the deck applies to fit each slide (see
`feedback_nivo_transform_double_scale`). Rejected alternatives at refinement:

- **Mafs** — Small (~30 KB), React-first, KaTeX for labels; the original
  choice at refinement. Deferred once the widget landed inside `<Slide>` and
  the class's real requirement — plotting sampled `y = f(x)` alongside
  reference lines, both under a scaled coordinate system — turned out to be
  a better fit for Nivo's data-points model. Mafs's math-first API
  (`Plot.OfX({ y: fn })`, `Coordinates.Cartesian`) is elegant but does not
  hand us the "sample the function, then let the chart do its axis/grid/
  legend" workflow the deck exercises repeatedly.
- **Plotly.js** — universal (2D + 3D + geo + network), but ~3 MB gzipped and
  every render pulls the full stack. The lazy load mitigates a lot, but the
  chunk size is a class of its own.
- **A bespoke SVG renderer** — Full control, zero dependency footprint, but
  every curve becomes a hand-crafted path and every future extension is a
  new implementation. The tax on future authoring is larger than a shipped
  chart library's size.

Miguel's decision at refinement + amendment: Nivo for curves now; when 3D or
graphs land, evaluate the best library for that case (Three.js for 3D, Nivo's
own `@nivo/network` or Cytoscape.js / React Flow for graphs) and wrap it
behind the same `type` prop.

**3. `type` is a prop, not a component name.** `type="curves"` today.
`type="3d"` and `type="graph"` are reserved for future extensions and reject
the render with a clear authoring error until they land. The alternative
(three components — `<CurvePlot>`, `<Plot3D>`, `<GraphPlot>`) reads three
names in the catalog and duplicates the container chrome (title, legend
placement, theme). One component with three modes names it once.

**4. Lazy-loaded, no per-document opt-in.** Registered in
`app/mdxComponents.ts` behind `Suspense` as `MathPlot: LazyMathPlot`, same
shape as `LazyMermaid`. Every reader of every document pays for what the
MDX map itself contains and nothing more — Nivo only enters the page once
`<MathPlot>` is actually mounted. Guarded in
`apps/web/src/architecture.test.ts` by a per-name case (the boundary the
lazy wrapper protects) and by the eager-graph walk (the invariant nothing
new can regress).

**5. What the widget shows today.** Curves as `y = f(x)`, one or many
overlaid, on a linear (or log) coordinate system. Optional title, legend
(auto-on for ≥2 functions), and reference lines (vertical or horizontal)
with optional labels. Fixed `yRange={[min, max]}` clips samples so lines
never overflow the axis frame. Colours cycle through a theme-safe palette;
the author picks a named colour with `color: "red"` if a specific curve
needs a specific hue.

**6. What is deferred.** Two items, each documented here so the future
maintainer does not re-derive them:

- **`type="3d"` and `type="graph"`.** Reserved in the prop surface;
  future issues filed alongside #218.
- **CodeMirror-integrated legend.** Not on the roadmap; the current
  legend is Nivo's native one, which is enough for what the class draws.

## Alternatives considered

**Mafs** — Original choice at refinement, replaced during implementation
(see §Decision item 2). The API was elegant for math authors, but the
practical demands of the class — plotting inside a CSS-transformed slide,
overlaying reference lines with `N₀` markers, mixing 3–8 curves in the same
frame — landed more cleanly on Nivo's charting primitives.

**Bespoke SVG per plot** — Rejected: does not scale to the number of plots
the class needs, and reinvents a chart-library API for every future user.

**Plotly** — Rejected: 3 MB gzipped is more than the whole current site
delta, and the lazy load only masks it.

**Three components rather than a `type` prop** — Rejected: three names in
the catalog, three sets of container chrome to keep in sync, three
consumers to migrate if the site's tokens move.

## Consequences

**New dependencies: `@nivo/core` and `@nivo/line` in `package.json`.**
Miguel approved at refinement (issue #218 body §Widgets) and at the
amendment (2026-08-25). Future math renderers do not need another ADR —
they use the surface this one adopts.

**Another lazy boundary and another architecture-test case.** The
per-name case in `apps/web/src/architecture.test.ts` grows by one entry
(`components/interactive/mathplot`), and the eager-graph walk catches any
static import that would put Nivo back in the entry chunk.

**A CSS-transform hazard the widget hides from the author.** Nivo's
`<ResponsiveLine>` measures its container via `ResizeObserver`, which
reports *post-transform* dimensions — inside a slide that the deck scales
to fit the viewport, the plot ends up half-sized. The widget picks
`<Line width={900}>` (fixed size) in presentation mode and
`<ResponsiveLine>` in book mode, so the author writes one component and
gets the right paint in both. Recorded in
`feedback_nivo_transform_double_scale`.

**Embedded mode for `<SideBySide>`.** When the plot mounts inside a
`<SideBySide>` column (~440 px wide), the default 900-px fixed-size
`<Line>` overflows the column and gets clipped by its `overflow-hidden`.
The widget reads `useEmbedded()` from the ancestor context (`#85`,
originally introduced for `CodeFence`); when true, it uses a narrower
`<Line width={440}>`, moves the legend to the BOTTOM of the plot, and
adjusts margin/spacing so the plot area itself doesn't collapse to a
sliver. Documenting so a future maintainer of `<SideBySide>` knows
`<MathPlot>` is a consumer of that context.

**y-clip when `yRange` is a fixed interval.** Nivo doesn't clip line
paths to the axis area, so a curve that shoots past `yMax` used to draw
outside the plot frame. The widget filters samples outside `[yMin, yMax]`
(and outside the log-space interval when `scale="log"`) so the line stops
cleanly at the boundary. Author sees a plot that respects its own frame
without any per-plot workaround.

**A new class the suite cannot fully verify.** Nivo renders SVG through
its own layout pipeline that jsdom cannot exercise. The unit test pins
what the component DECLARES (the sampled points it hands the library, the
annotations, the legend visibility, the y-clip) with the library replaced
by a stub. The paint itself is confirmed in a real browser during manual
verification.

**A reserved prop surface that fails gracefully.** `type="3d"` and
`type="graph"` today render an authoring error. When they land, the
author's document upgrades without changing the prop — the error branch
becomes a real render.
