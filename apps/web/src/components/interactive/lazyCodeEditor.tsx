import { Suspense, lazy } from 'react';

import type { CodeEditorProps } from './CodeEditor';

// The MDX component map is built eagerly in the shell, so registering the real
// editor there would drag CodeMirror into the entry chunk — 400kB paid by every
// reader of every page, most of which embed no code at all (issue #74 AC7).
const Editor = lazy(async () => ({ default: (await import('./CodeEditor')).CodeEditor }));

/** The editor as documents see it: loaded the first time a page actually uses one. */
export function LazyCodeEditor(props: CodeEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="not-prose my-6 h-40 animate-pulse rounded-lg border border-zinc-700 bg-zinc-900" />
      }
    >
      <Editor {...props} />
    </Suspense>
  );
}
