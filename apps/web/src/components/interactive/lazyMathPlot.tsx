import { Suspense, lazy } from 'react';

import type { MathPlotProps } from './MathPlot';

// Same reason as lazyMermaid: Nivo (@nivo/line) is a chart library that
// pulls its own React tree and a slice of d3 for scales / shapes /
// interpolation. Registering the real component here would put the whole
// package in the entry chunk of every reader of every page. Guarded in
// src/architecture.test.ts by a per-name case and by the eager-graph walk.
const Real = lazy(async () => ({ default: (await import('./MathPlot')).MathPlot }));

/** The math-plot widget as documents see it: loaded the first time a page has one. */
export function LazyMathPlot(props: MathPlotProps) {
  return (
    <Suspense
      fallback={
        <div className="not-prose my-6 h-72 animate-pulse rounded-lg border border-rule bg-surface" />
      }
    >
      <Real {...props} />
    </Suspense>
  );
}
