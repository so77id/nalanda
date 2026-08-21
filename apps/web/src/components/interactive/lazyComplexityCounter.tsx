import { Suspense, lazy } from 'react';

import type { ComplexityCounterProps } from './ComplexityCounter';

// Same reason as the other lazy wrappers: the MDX component map is built
// eagerly in the shell, and <ComplexityCounter> — although it does not drive
// the runtime or wrap the CodeEditor — carries lucide icons and formula
// evaluation glue that need not ride in the entry chunk of pages that use no
// counter. Registered lazily to keep the pattern consistent and to leave
// room for future extensions (e.g. a recursion-friendly variant for Peli 2
// that may pull in more).
const Real = lazy(async () => ({
  default: (await import('./ComplexityCounter')).ComplexityCounter,
}));

/** The complexity-counter widget as documents see it: loaded on demand. */
export function LazyComplexityCounter(props: ComplexityCounterProps) {
  return (
    <Suspense
      fallback={
        <div className="not-prose my-6 h-64 animate-pulse rounded-lg border border-rule bg-surface" />
      }
    >
      <Real {...props} />
    </Suspense>
  );
}
