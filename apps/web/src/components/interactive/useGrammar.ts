import type { Extension } from '@codemirror/state';
import { useEffect, useState } from 'react';

import type { RuntimeId } from '../../lib/runtimeIds';
import { loadGrammar } from '../../runtime';

/**
 * The CodeMirror grammar for a language, once it lands.
 *
 * `null` until then, and the editor renders unhighlighted for that moment. That
 * is not new — it used to render unhighlighted until the whole runtime module
 * arrived, which is strictly slower — but it is now the ONLY thing the grammar
 * waits on, which is the point: a runtime consumer that mounts no editor never
 * calls this and never pays for it (#122).
 *
 * Two real consumers, which is the moment the style guide names as the time to
 * extract (`frontend-code-style.md` §Components): the editor and the exercise.
 *
 * A failure is deliberately silent. A missing grammar costs colour, and there is
 * no honest way to tell a student "your code is not highlighted" that is worth
 * more than the unhighlighted code itself. Whatever the reader came to run is
 * governed by `loadRuntime`, which reports its own failures.
 */
export function useGrammar(language: RuntimeId | null): Extension | null {
  const [grammar, setGrammar] = useState<Extension | null>(null);

  useEffect(() => {
    // Cleared first, including when the language merely changes: keeping the
    // previous grammar until the next one lands highlights Java as Python for a
    // frame, which is worse than not highlighting it at all.
    setGrammar(null);
    if (language === null) return;
    let cancelled = false;
    void loadGrammar(language).then(
      (extension) => {
        if (!cancelled) setGrammar(extension);
      },
      () => {
        if (!cancelled) setGrammar(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [language]);

  return grammar;
}
