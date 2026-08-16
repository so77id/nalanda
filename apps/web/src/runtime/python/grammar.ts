import { python } from '@codemirror/lang-python';
import type { Extension } from '@codemirror/state';

/**
 * The Python CodeMirror grammar, in its own module so it lands in its own chunk.
 *
 * Deliberately NOT part of the runtime module: a consumer that drives the runtime
 * without mounting an editor — <MemoryDiagram> draws its own listing — would pay
 * for a highlighter it never renders. Reached through `loadGrammar('python')`.
 */
export function grammar(): Extension {
  return python();
}
