import { java } from '@codemirror/lang-java';
import type { Extension } from '@codemirror/state';

/** The Java CodeMirror grammar, in its own chunk. Why: `loadGrammar` in the registry. */
export function grammar(): Extension {
  return java();
}
