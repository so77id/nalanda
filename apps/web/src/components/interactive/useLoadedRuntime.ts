import { useEffect, useState } from 'react';

import type { RuntimeId } from '../../lib/runtimeIds';
import type { Runtime, RuntimeModule } from '../../runtime';
import { loadRuntime, useRuntime } from '../../runtime';

/** A runtime that is still loading, plus whatever went wrong loading it. */
export interface LoadedRuntime extends Runtime {
  /** False until the module has arrived; the run button stays disabled meanwhile. */
  ready: boolean;
  /** Why the module never arrived, for the diagnostics panel. */
  failure: string | null;
}

/**
 * Loads a runtime module and hands back a runtime bound to it.
 *
 * Two components need exactly this — an exercise and a memory diagram — which is
 * the second real use the style guide names as the moment to extract
 * (`frontend-code-style.md` §Components). `CodeEditor` is deliberately not a
 * third: its version juggles several languages at once and seeds drafts, so
 * folding it in here would generalise the hook past what either caller wants.
 *
 * The module itself is deliberately not handed back. It used to be, for the one
 * caller that wanted a CodeMirror grammar off it; grammars come from
 * `useGrammar` now (#122), and returning the module again would re-open the door
 * to a consumer reaching past `run` into a runtime's internals.
 *
 * The compiler behind `createWorker` stays untouched until the reader presses
 * the button (issue #74 AC6).
 */
export function useLoadedRuntime(language: RuntimeId): LoadedRuntime {
  const [module, setModule] = useState<RuntimeModule | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRuntime(language).then(
      (loaded) => {
        if (!cancelled) setModule(loaded);
      },
      (error: unknown) => {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [language]);

  const runtime = useRuntime({
    runtimeId: module ? language : null,
    createWorker: () => {
      if (!module) throw new Error(`the ${language} runtime is still loading`);
      return module.createWorker();
    },
  });

  return { ...runtime, ready: module !== null, failure };
}
