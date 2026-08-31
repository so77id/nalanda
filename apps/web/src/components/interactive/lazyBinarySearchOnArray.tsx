import { Suspense, lazy } from 'react';

import type { BinarySearchOnArrayProps } from './BinarySearchOnArray';

// Same reason as the other lazy wrappers: the MDX component map is built
// eagerly in the shell. <BinarySearchOnArray> composes <CodeStepper> (which
// pulls CodeMirror + the java grammar the first time it renders) plus lucide
// icons for its controls, so it must not ride in the entry chunk of pages
// that use no binary-search widget. Guarded per-name in architecture.test.ts.
const Real = lazy(async () => ({
  default: (await import('./BinarySearchOnArray')).BinarySearchOnArray,
}));

/** The binary-search visualiser as documents see it: loaded on demand. */
export function LazyBinarySearchOnArray(props: BinarySearchOnArrayProps) {
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
