import type { RuntimeDescriptor, RuntimeId, RuntimeModule } from './contract';
import { cppDescriptor } from './cpp/descriptor';
import { javaDescriptor } from './java/descriptor';
import { pythonDescriptor } from './python/descriptor';

/**
 * Every implemented runtime, in picker order. Adding a language means adding its
 * descriptor here and its case to `loadRuntime` — the two halves the registry
 * keeps apart so listing a language stays cheap and loading one stays lazy.
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
 * Loads a runtime's compiler and grammar. Written as a switch of static
 * `import()` calls so the bundler can split one chunk per language; a computed
 * specifier would defeat that and pull every toolchain into one chunk.
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
