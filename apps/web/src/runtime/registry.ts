import type { Extension } from '@codemirror/state';

import type { RuntimeDescriptor, RuntimeId, RuntimeModule } from './contract';
import { cppDescriptor } from './cpp/descriptor';
import { javaDescriptor } from './java/descriptor';
import { pythonDescriptor } from './python/descriptor';

/**
 * Every implemented runtime, in picker order. Adding a language means adding its
 * descriptor here, a case to `loadRuntime` AND a case to `loadGrammar` — three
 * parts the registry keeps apart so listing a language stays cheap, loading a
 * compiler stays lazy, and a consumer that mounts no editor never pays for a
 * grammar (#122).
 */
export const runtimeDescriptors: RuntimeDescriptor[] = [
  javaDescriptor,
  cppDescriptor,
  pythonDescriptor,
];

/** The descriptor for `id`, or null when no runtime implements it yet. */
export function descriptorOf(id: RuntimeId): RuntimeDescriptor | null {
  return runtimeDescriptors.find((descriptor) => descriptor.id === id) ?? null;
}

/**
 * Loads a runtime's compiler. Written as a switch of static `import()` calls so
 * the bundler can split one chunk per language; a computed specifier would
 * defeat that and pull every toolchain into one chunk.
 *
 * The grammar is NOT here — see `loadGrammar`.
 */
export async function loadRuntime(id: RuntimeId): Promise<RuntimeModule> {
  switch (id) {
    case 'cpp':
      return import('./cpp');
    case 'python':
      return import('./python');
    case 'java':
      return import('./java');
    default:
      throw new Error(`no runtime registered for "${id}"`);
  }
}

/**
 * Loads a language's CodeMirror grammar — the editor's half of a language, split
 * from the compiler's half above.
 *
 * Two entry points rather than one module with two exports, because two
 * consumers genuinely need one without the other. `<MemoryDiagram>` drives a
 * real JVM and draws its own listing (ADR-0026/0028), so while the grammar sat
 * inside the runtime module it paid a full grammar for a highlighter it never
 * rendered; ADR-0018 §4 carries what that cost and what the split bought, per
 * language (#122). The mirror case is real too: an editor
 * highlights before — and whether or not — anything is ever run.
 *
 * Same switch-of-static-`import()` shape as `loadRuntime`, for the same reason.
 */
export async function loadGrammar(id: RuntimeId): Promise<Extension> {
  switch (id) {
    case 'cpp':
      return (await import('./cpp/grammar')).grammar();
    case 'python':
      return (await import('./python/grammar')).grammar();
    case 'java':
      return (await import('./java/grammar')).grammar();
    default:
      throw new Error(`no grammar registered for "${id}"`);
  }
}
