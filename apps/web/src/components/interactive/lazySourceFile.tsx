import { Suspense, lazy } from 'react';

import type { SourceFileProps } from './SourceFile';

export type { SourceFileProps };

// Same boundary as `lazyStepShow.tsx`: <SourceFile> mounts a <CodeStepper>,
// which imports CodeMirror and `useGrammar`, and it carries the course's source
// files (`lib/contentCode`). Registered eagerly, both would land in the entry
// chunk of every reader of every page.
const Real = lazy(async () => ({ default: (await import('./SourceFile')).SourceFile }));

/** A listing quoted from a file, as documents see it: loaded the first time a page mounts one. */
export function LazySourceFile(props: SourceFileProps) {
  return (
    <Suspense
      fallback={
        <div className="not-prose my-6 h-32 animate-pulse rounded-lg border border-rule bg-surface" />
      }
    >
      <Real {...props} />
    </Suspense>
  );
}
