import { Suspense, lazy } from 'react';

import type { PartitionStepperProps } from './PartitionStepper';
export type { PartitionStepperProps } from './PartitionStepper';

const Real = lazy(async () => ({
  default: (await import('./PartitionStepper')).PartitionStepper,
}));

/** The partition-operation step widget as documents see it: loaded on demand. */
export function LazyPartitionStepper(props: PartitionStepperProps) {
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
