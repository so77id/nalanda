import { Suspense, lazy } from 'react';

import type { SortStepperProps } from './SortStepper';

// Same pattern as lazyBinarySearchOnArray / lazyComplexityExercise: the MDX
// components map is built eagerly, and this widget composes <CodeStepper>
// (CodeMirror + java grammar) plus <DivideCombineTree> for merge/quick.
// Registering it lazily keeps CodeMirror off the entry chunk for readers of
// pages that mount no stepper. Guarded by architecture.test.ts. ADR-0065.
const Real = lazy(async () => ({
  default: (await import('./SortStepper')).SortStepper,
}));

/** The sort-stepper widget as documents see it: loaded on demand. */
export function LazySortStepper(props: SortStepperProps) {
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
