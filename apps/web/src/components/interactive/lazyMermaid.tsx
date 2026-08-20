import { Suspense, lazy } from 'react';

import type { MermaidProps } from './Mermaid';

// Same reason as lazyCodeEditor / lazyExercise / lazyPredictOutput:
// the MDX component map is built eagerly in the shell, and `mermaid` is a
// heavy library (~200kB gzipped of mermaid-only chunks, measured — ADR-0040
// §Consequences) that reaches
// dagre/d3/parsers. Registering the real component would put all of that in
// the entry chunk of every reader of every page, whether or not the page has
// a diagram at all. Guarded in src/architecture.test.ts by a per-name case
// and by the eager-graph walk.
const Real = lazy(async () => ({ default: (await import('./Mermaid')).Mermaid }));

/** The class-diagram (and any other mermaid) component as documents see it: loaded the first time a page has one. */
export function LazyMermaid(props: MermaidProps) {
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
