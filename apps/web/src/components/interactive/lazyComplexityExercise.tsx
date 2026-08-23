import { Suspense, lazy } from 'react';

import type { ComplexityExerciseProps } from './ComplexityExercise';

// Same pattern as lazyComplexityCounter / lazyExercise: the MDX components map
// is built eagerly, and this widget composes <CodeStepper> + <ComplexityCounter>
// — both CodeMirror-adjacent. Registering it lazily keeps the counter/editor
// chunks off the entry chunk for readers of pages that mount no exercise.
const Real = lazy(async () => ({
  default: (await import('./ComplexityExercise')).ComplexityExercise,
}));

/** The complexity-exercise widget as documents see it: loaded on demand. */
export function LazyComplexityExercise(props: ComplexityExerciseProps) {
  return (
    <Suspense
      fallback={
        <div className="not-prose my-6 h-72 animate-pulse rounded-lg border border-rule bg-surface" />
      }
    >
      <Real {...props} />
    </Suspense>
  );
}
