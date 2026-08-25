import { Suspense, lazy } from 'react';

import type { ComplexityHierarchyProps } from './ComplexityHierarchy';

// Not for CodeMirror weight (this widget carries none) but for pattern
// consistency with the other interactive widgets — the MDX components map is
// built eagerly in the shell, so keeping every widget behind a lazy wrapper
// keeps the entry chunk boundary consistent and leaves room for future
// interactive extensions of the hierarchy (drill-in animations,
// class-relative graphs) without moving the seam.
const Real = lazy(async () => ({
  default: (await import('./ComplexityHierarchy')).ComplexityHierarchy,
}));

/** The complexity-hierarchy widget as documents see it: loaded on demand. */
export function LazyComplexityHierarchy(props: ComplexityHierarchyProps) {
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
