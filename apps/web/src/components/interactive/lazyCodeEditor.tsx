import { Suspense, lazy } from 'react';

import { useEmbedded } from '../embedded';
import { placeholderClass } from './placeholder';
import type { CodeEditorProps } from './CodeEditor';

// The MDX component map is built eagerly in the shell, so registering the real
// editor there would drag CodeMirror into the entry chunk — 400kB paid by every
// reader of every page, most of which embed no code at all (issue #74 AC7).
const Editor = lazy(async () => ({ default: (await import('./CodeEditor')).CodeEditor }));

/** The editor as documents see it: loaded the first time a page actually uses one. */
export function LazyCodeEditor(props: CodeEditorProps) {
  // The placeholder answers the same question the editor does — is something
  // already framing me? Without this, a fence inside a SideBySide column showed
  // the doubled border for the whole of the chunk fetch: exactly the thing the
  // context exists to remove, visible for the one moment the reader is looking
  // at an empty box.
  const embedded = useEmbedded();

  return (
    <Suspense fallback={<div className={placeholderClass(embedded)} />}>
      <Editor {...props} />
    </Suspense>
  );
}
