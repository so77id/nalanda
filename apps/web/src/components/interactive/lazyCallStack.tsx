import { Suspense, lazy } from 'react';

import type { CallStackProps } from './CallStack';

// Same reason as the other lazy wrappers: the MDX component map is built
// eagerly in the shell. <CallStack> composes <CodeStepper> (which pulls
// CodeMirror + the java grammar the first time it renders) plus lucide icons
// for its controls, so it must not ride in the entry chunk of pages that use
// no stack widget.
const Real = lazy(async () => ({
  default: (await import('./CallStack')).CallStack,
}));

/** The call-stack widget as documents see it: loaded on demand. */
export function LazyCallStack(props: CallStackProps) {
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
