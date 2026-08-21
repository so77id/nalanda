import { Suspense, lazy } from 'react';

import type { BenchmarkProps } from './Benchmark';

// Same reason as lazyCodeEditor / lazyPredictOutput: the MDX component map is
// built eagerly in the shell, and `<Benchmark>` reaches the runtime seam (through
// `useLoadedRuntime`) and CodeMirror (through `LazyCodeEditor`). Registering the
// real component here would put both into the entry chunk of every reader of
// every page. Guarded in src/architecture.test.ts by its own per-name case and
// by the eager-graph walk.
const Real = lazy(async () => ({ default: (await import('./Benchmark')).Benchmark }));

/** The benchmark widget as documents see it: loaded the first time a page has one. */
export function LazyBenchmark(props: BenchmarkProps) {
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
