import { Suspense, lazy } from 'react';

import type { FibTabStepsProps } from './FibTabSteps';
// Re-export so consumers of the components seam import types from the
// lazy wrapper, not the real widget — the arch guard requires it.
export type { FibTabStepsProps } from './FibTabSteps';

// Same rule as the other lazy wrappers: this widget composes <StepShow>,
// which pulls the CodeStepper (CodeMirror + java grammar) the first
// time it renders. Documents that never use fib tab steps must not
// pay for it in their entry chunk.
const Real = lazy(async () => ({
  default: (await import('./FibTabSteps')).FibTabSteps,
}));

/** The fib-tabulated step widget as documents see it: loaded on demand. */
export function LazyFibTabSteps(props: FibTabStepsProps) {
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
