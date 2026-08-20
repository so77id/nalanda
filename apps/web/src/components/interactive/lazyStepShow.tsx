import { Suspense, lazy } from 'react';

import type { StepShowProps } from './StepShow';

// Re-exported so consumers can type against `StepShowProps` without statically
// importing the real widget module (that path is what the per-name entry-chunk
// guard forbids).
export type { StepShowProps };

// Same rule as `lazyCodeEditor.tsx`, reached by a different route: `<StepShow>`
// mounts a `<CodeStepper>` that imports CodeMirror + `useGrammar` for
// syntax-coloured listings. Since #85 shipped, that is the shape every `java`
// fence in `content/` already loads through `<MdxPre>` → `<LazyCodeEditor>`,
// so registering the real `<StepShow>` eagerly in the MDX map would put
// CodeMirror in the entry chunk of every reader of every page — including the
// ones with no diagram at all. The lazy boundary is what keeps that off the
// entry chunk (guarded in `src/architecture.test.ts`, both by name and by the
// eager-graph walk).
const Real = lazy(async () => ({ default: (await import('./StepShow')).StepShow }));

/** The step-through widget as documents see it: loaded the first time a page mounts one. */
export function LazyStepShow(props: StepShowProps) {
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
