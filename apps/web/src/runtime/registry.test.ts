import { describe, expect, it } from 'vitest';

import type { RuntimeId } from './contract';
import { RUNTIME_IDS } from './contract';
import { descriptorOf, loadRuntime, runtimeDescriptors } from './registry';

describe('runtime registry', () => {
  // Registry-driven invariant (testing-strategy.md): every registered runtime is
  // gated the moment it is registered, so a new language cannot skip the rules.
  it('registers at least one runtime', () => {
    expect(runtimeDescriptors.length).toBeGreaterThan(0);
  });

  it.each(runtimeDescriptors)('$id has a complete descriptor', (descriptor) => {
    expect(RUNTIME_IDS).toContain(descriptor.id);
    expect(descriptor.label).not.toBe('');
    expect(descriptor.fileName).toMatch(/\.\w+$/);
    expect(descriptor.defaultCode.trim()).not.toBe('');
  });

  it.each(runtimeDescriptors)(
    '$id loads a module that agrees with its descriptor',
    async ({ id }) => {
      const module = await loadRuntime(id);

      expect(module.descriptor).toEqual(descriptorOf(id));
      expect(typeof module.createWorker).toBe('function');
      expect(module.codeMirrorLanguage()).toBeDefined();
    },
  );

  it('has no duplicate ids', () => {
    const ids = runtimeDescriptors.map((descriptor) => descriptor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fails loudly for a language that has no runtime', async () => {
    // Cast past the type system on purpose: the branch exists for the window
    // between adding an id and implementing it (guides/add-a-language-runtime.md
    // step 1), and only a cast can reach it once every language is registered.
    await expect(loadRuntime('rust' as RuntimeId)).rejects.toThrow(/no runtime/i);
  });
});
