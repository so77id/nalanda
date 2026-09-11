import { Suspense, lazy } from 'react';

import type { SequenceStepperProps } from './SequenceStepper';

export type { SequenceStepperProps };

// Same pattern as lazySortStepper / lazyMergeStepper: the MDX components map
// is built eagerly, and this widget composes <CodeStepper> (CodeMirror + the
// java grammar). Registering it lazily keeps CodeMirror off the entry chunk
// for readers of pages that mount no stepper. Guarded by
// architecture.test.ts. ADR-0074.
const Real = lazy(async () => ({
  default: (await import('./SequenceStepper')).SequenceStepper,
}));

/** The sequence-stepper widget as documents see it: loaded on demand. */
export function LazySequenceStepper(props: SequenceStepperProps) {
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
