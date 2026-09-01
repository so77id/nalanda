import { Suspense, lazy } from 'react';

import type { KaratsubaVizProps } from './KaratsubaViz';

// Composes <CodeStepper> (CodeMirror + java grammar) — same lazy shape as the
// other D&C widgets in this WP. Guarded per-name in architecture.test.ts.
// ADR-0062.
const Real = lazy(async () => ({
  default: (await import('./KaratsubaViz')).KaratsubaViz,
}));

/** The Karatsuba visualiser as documents see it: loaded on demand. */
export function LazyKaratsubaViz(props: KaratsubaVizProps) {
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
