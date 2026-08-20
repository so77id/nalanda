import { Suspense, lazy } from 'react';

import type { PredictOutputProps } from './PredictOutput';

// Same reason as lazyCodeEditor: the MDX component map is built eagerly in
// the shell, and PredictOutput reaches the runtime seam (through
// `useLoadedRuntime`) and CodeMirror (through `LazyCodeEditor`). Registering
// the real one would put both into the entry chunk of every reader of every
// page. Guarded in src/architecture.test.ts by its own case and by the
// eager-graph walk.
const Real = lazy(async () => ({ default: (await import('./PredictOutput')).PredictOutput }));

/** The predict-and-reveal card as documents see it: loaded the first time a page has one. */
export function LazyPredictOutput(props: PredictOutputProps) {
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
