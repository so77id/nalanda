import { Suspense, lazy } from 'react';

import type { GraphWalkProps } from './GraphWalk';
// Re-export so consumers of the components seam import types from the
// lazy wrapper, not the real widget — the arch guard requires it.
export type { GraphWalkProps } from './GraphWalk';

const Real = lazy(async () => ({
  default: (await import('./GraphWalk')).GraphWalk,
}));

/** The graph walk as documents see it: loaded on demand (it carries `<StepShow>`). */
export function LazyGraphWalk(props: GraphWalkProps) {
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
