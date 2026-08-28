import { Suspense, lazy } from 'react';

import type { HanoiPlaygroundProps } from './HanoiPlayground';

// Lazy for pattern consistency with the other interactive widgets. HanoiPlayground
// itself pulls only React state + lucide icons + inline-styled SVG-free towers,
// so the added weight is modest, but the lazy wrapper keeps the boundary
// uniform and lets architecture.test.ts pin the per-name chunk.
const Real = lazy(async () => ({
  default: (await import('./HanoiPlayground')).HanoiPlayground,
}));

/** The HanoiPlayground widget as documents see it: loaded on demand. */
export function LazyHanoiPlayground(props: HanoiPlaygroundProps) {
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
