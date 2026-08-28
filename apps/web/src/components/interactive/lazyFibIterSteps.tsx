import { Suspense, lazy } from 'react';

import type { FibIterStepsProps } from './FibIterSteps';
// Re-export so consumers of the components seam import types from the
// lazy wrapper, not the real widget — the arch guard requires it.
export type { FibIterStepsProps } from './FibIterSteps';

const Real = lazy(async () => ({
  default: (await import('./FibIterSteps')).FibIterSteps,
}));

/** The fib-iterative step widget as documents see it: loaded on demand. */
export function LazyFibIterSteps(props: FibIterStepsProps) {
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
