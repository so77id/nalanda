import { Suspense, lazy } from 'react';

import type { MemoryDiagramProps } from './MemoryDiagram';

// Same reason as lazyCodeEditor and lazyExercise, reached by a different route:
// the MDX component map is built eagerly in the shell, and MemoryDiagram imports
// the runtime seam — which brings the registry, every descriptor and the Java
// launcher with it. Registering the real component would put all of that in the
// entry chunk, paid by every reader of every page (guarded in
// src/architecture.test.ts, both by name and by the eager-graph walk).
const Real = lazy(async () => ({ default: (await import('./MemoryDiagram')).MemoryDiagram }));

/** The memory diagram as documents see it: loaded the first time a page has one. */
export function LazyMemoryDiagram(props: MemoryDiagramProps) {
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
