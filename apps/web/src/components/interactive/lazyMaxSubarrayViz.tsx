import { Suspense, lazy } from 'react';

import type { MaxSubarrayVizProps } from './MaxSubarrayViz';

// <MaxSubarrayViz> composes <CodeStepper> (CodeMirror + java grammar) plus
// lucide icons for its controls. Registering the real component eagerly would
// pull CodeMirror into the entry chunk of every reader of every page. Guarded
// per-name in architecture.test.ts. ADR-0060.
const Real = lazy(async () => ({
  default: (await import('./MaxSubarrayViz')).MaxSubarrayViz,
}));

/** The max-subarray D&C visualiser as documents see it: loaded on demand. */
export function LazyMaxSubarrayViz(props: MaxSubarrayVizProps) {
  return (
    <Suspense
      fallback={
        <div className="not-prose my-6 h-80 animate-pulse rounded-lg border border-rule bg-surface" />
      }
    >
      <Real {...props} />
    </Suspense>
  );
}
