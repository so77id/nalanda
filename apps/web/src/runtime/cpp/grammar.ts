import { cpp } from '@codemirror/lang-cpp';
import type { Extension } from '@codemirror/state';

/** The C++ CodeMirror grammar, in its own chunk. Why: `loadGrammar` in the registry. */
export function grammar(): Extension {
  return cpp();
}
