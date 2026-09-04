import { Suspense, lazy } from 'react';

import type { MergeStepperProps } from './MergeStepper';
export type { MergeStepperProps } from './MergeStepper';

const Real = lazy(async () => ({
  default: (await import('./MergeStepper')).MergeStepper,
}));

/** The merge-operation step widget as documents see it: loaded on demand. */
export function LazyMergeStepper(props: MergeStepperProps) {
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
