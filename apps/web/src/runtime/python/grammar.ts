import { python } from '@codemirror/lang-python';
import type { Extension } from '@codemirror/state';

/** The Python CodeMirror grammar, in its own chunk. Why: `loadGrammar` in the registry. */
export function grammar(): Extension {
  return python();
}
