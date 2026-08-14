import { Suspense, lazy } from 'react';

import type { ExerciseProps } from './Exercise';

// Same reason as lazyCodeEditor: the MDX component map is built eagerly in the
// shell, and Exercise embeds CodeMirror. Registering the real one would put the
// editor back in the entry chunk, paid by every reader of every page (issue #74
// AC7, guarded in src/architecture.test.ts).
const Real = lazy(async () => ({ default: (await import('./Exercise')).Exercise }));

/** The exercise as documents see it: loaded the first time a page has one. */
export function LazyExercise(props: ExerciseProps) {
  return (
    <Suspense
      fallback={
        <div className="not-prose my-6 h-56 animate-pulse rounded-lg border border-rule bg-surface" />
      }
    >
      <Real {...props} />
    </Suspense>
  );
}
