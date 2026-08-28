import { Suspense, lazy } from 'react';

import type { FibMemoStepsProps } from './FibMemoSteps';

// Same rule as the other lazy wrappers: this widget composes <StepShow>,
// which pulls the CodeStepper (CodeMirror + java grammar) the first
// time it renders. Documents that never use fib memo steps must not
// pay for it in their entry chunk.
const Real = lazy(async () => ({
  default: (await import('./FibMemoSteps')).FibMemoSteps,
}));

/** The fib-memoized step widget as documents see it: loaded on demand. */
export function LazyFibMemoSteps(props: FibMemoStepsProps) {
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
