import { cpp } from '@codemirror/lang-cpp';
import type { Extension } from '@codemirror/state';

/**
 * The C++ CodeMirror grammar, in its own module so it lands in its own chunk.
 *
 * Deliberately NOT part of the runtime module: a consumer that drives the runtime
 * without mounting an editor — <MemoryDiagram> draws its own listing — would pay
 * for a highlighter it never renders. Reached through `loadGrammar('cpp')`.
 */
export function grammar(): Extension {
  return cpp();
}
