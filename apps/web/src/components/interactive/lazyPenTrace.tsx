import { Suspense, lazy } from 'react';

import type { PenTraceProps } from './PenTrace';

// Lazy like HanoiPlayground, its precedent: a widget one class mounts stays
// out of the entry chunk every reader of every page downloads. It pulls only
// React state, lucide icons and NodeGraph's geometry, so the split is about
// the first paint of the other pages, not about a heavy package. Measured
// on the shipped build against #356's S2 commit, the wrapper and its
// registration cost the entry chunk 423 bytes raw, 81 with gzip -9.
const Real = lazy(async () => ({
  default: (await import('./PenTrace')).PenTrace,
}));

/** The PenTrace widget as documents see it: loaded on demand. */
export function LazyPenTrace(props: PenTraceProps) {
  return (
    <Suspense
      fallback={
        <div className="not-prose my-6 h-64 animate-pulse rounded-lg border border-rule bg-surface" />
      }
    >
      <Real {...props} />
    </Suspense>
  );
}
