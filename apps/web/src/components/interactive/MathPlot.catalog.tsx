import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyMathPlot as MathPlot } from './lazyMathPlot';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const mathPlotCatalogEntry: CatalogEntry = {
  name: 'MathPlot',
  family: 'interactive',
  description:
    "A 2D math function plotter for course documents (ADR-0046). The author declares one or more `y = f(x)` and the widget paints them on a shared coordinate system with an optional legend, optional reference lines, and Mafs's built-in hover interaction. Built on Mafs, a React-first math-visualization library.",
  whenToUse:
    'Anywhere the class needs to draw a mathematical curve or overlay several: the growth-order comparison in Act 4 (1, log N, N, N log N, N squared, 2 to the N), the O grande / Omega / Theta definitions with a reference line drawn as `c * g(N)`, the crossing between a linear-with-big-constant and a quadratic-with-small-constant. ' +
    'NOT for pie charts, bar charts, statistical plots — Mafs is a math renderer, not a dashboard toolkit. ' +
    'NOT for 3D surfaces or node-edge graphs yet — the widget reserves `type="3d"` and `type="graph"` for future extensions (ADR-0046 Alternatives; issues filed alongside #218). Keep the curve count low — the point is usually one curve against one reference, or a small comparison of 3-5 orders. A dozen curves overlap into noise.',
  props: [
    {
      name: 'type',
      type: '"curves" | "3d" | "graph"',
      description:
        'Which flavour of plot to render. Only "curves" validates today; "3d" and "graph" are documented as future extensions and fall through to an authoring error until they land. Defaults to "curves".',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Optional title shown above the plot, as a figcaption.',
    },
    {
      name: 'functions',
      type: '{ label, fn, color?, dashed? }[]',
      description:
        'List of curves to draw. Each has a legend label (LaTeX-friendly), a JS callback for the function, and optional color / dashed style. Required in "curves" mode. Colors cycle through blue, green, red, orange, purple, pink, indigo, yellow when unspecified.',
    },
    {
      name: 'xRange',
      type: '[number, number]',
      description:
        'Visible x range as [min, max]. Required. Pick a range where the curves diverge visibly — plotting N squared and log N together on [0, 3] hides the point they are making.',
    },
    {
      name: 'yRange',
      type: '[number, number] | "auto"',
      description:
        'Visible y range as [min, max], or "auto" (default) to fit to the plotted values. Set explicitly when the auto-fit chops the top off an exponential.',
    },
    {
      name: 'scale',
      type: '"linear" | "log" | "loglog"',
      description:
        'Scale mode. Only "linear" validates today; "log" and "loglog" are future extensions (ADR-0046). Defaults to "linear".',
    },
    {
      name: 'showLegend',
      type: 'boolean',
      description:
        'Whether to render the legend. Defaults to true when there are two or more functions. Set to false for a single-curve plot or when the legend competes with an annotation label.',
    },
    {
      name: 'annotations',
      type: 'Array<{ type: "verticalLine" | "horizontalLine", ... }>',
      description:
        'Optional reference lines: `{ type: "verticalLine", x, label? }` or `{ type: "horizontalLine", y, label? }`. Used for the O grande / Omega / Theta N_zero marker and any "the algorithm changes behaviour here" pin.',
    },
    {
      name: 'samples',
      type: 'number',
      description:
        'Sampling resolution for the auto y-range fit. Higher = smoother auto-fit, slower. Defaults to 200.',
    },
  ],
  examples: [
    {
      title: 'Orders of growth in Act 4: five curves diverge visibly on [1, 20]',
      code: '<MathPlot type="curves" functions={[{ label: "1", fn: () => 1 }, ...]} xRange={[1, 20]} />',
      render: () => (
        <MathPlot
          type="curves"
          title="Ordenes de crecimiento"
          xRange={[1, 20]}
          functions={[
            { label: '1', fn: () => 1, color: 'orange' },
            { label: 'lg n', fn: (n) => Math.log2(n), color: 'green' },
            { label: 'n', fn: (n) => n, color: 'blue' },
            { label: 'n lg n', fn: (n) => n * Math.log2(n), color: 'violet' },
            { label: 'n squared', fn: (n) => n * n, color: 'red' },
          ]}
        />
      ),
    },
    {
      title:
        'O grande with reference line: T(N) = 4N + 4 is O(N) since it stays under 5N past N_zero = 4',
      code: '<MathPlot type="curves" xRange={[0, 20]} functions={[{ label: "T(N)", fn: n => 4*n+4 }, { label: "5N", fn: n => 5*n, dashed: true }]} annotations={[{ type: "verticalLine", x: 4, label: "N_zero" }]} />',
      render: () => (
        <MathPlot
          type="curves"
          title="T(N) = 4N + 4 es O(N)"
          xRange={[0, 20]}
          functions={[
            { label: 'f = 4N + 4', fn: (n) => 4 * n + 4, color: 'blue' },
            { label: 'c * g = 5N', fn: (n) => 5 * n, color: 'red', dashed: true },
          ]}
          annotations={[{ type: 'verticalLine', x: 4, label: 'N_zero' }]}
        />
      ),
    },
    {
      title: 'No functions: the error is for the author, not the student',
      code: '<MathPlot type="curves" xRange={[0, 10]} />',
      render: () => <MathPlot type="curves" xRange={[0, 10]} />,
    },
    {
      title: 'Reserved type: 3d and graph fail with a clear authoring error until implemented',
      code: '<MathPlot type="3d" xRange={[0, 10]} functions={[]} />',
      render: () => <MathPlot type="3d" xRange={[0, 10]} functions={[]} />,
    },
  ],
};
