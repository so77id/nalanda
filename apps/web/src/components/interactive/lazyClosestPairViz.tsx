import { Suspense, lazy } from 'react';

import type { ClosestPairVizProps } from './ClosestPairViz';

// Composes <CodeStepper> (CodeMirror + java grammar) — same lazy shape as the
// other D&C widgets in this WP. Guarded per-name in architecture.test.ts.
// ADR-0061.
const Real = lazy(async () => ({
  default: (await import('./ClosestPairViz')).ClosestPairViz,
}));

/** The closest-pair D&C visualiser as documents see it: loaded on demand. */
export function LazyClosestPairViz(props: ClosestPairVizProps) {
  return (
    <Suspense
      fallback={
        <div className="not-prose my-6 h-96 animate-pulse rounded-lg border border-rule bg-surface" />
      }
    >
      <Real {...props} />
    </Suspense>
  );
}
