import { describe, expect, it } from 'vitest';

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

  it('fails loudly for a language that has no runtime yet', async () => {
    const unregistered = RUNTIME_IDS.filter((id) => descriptorOf(id) === null);
    // Nothing to assert once every language is implemented — that is the goal.
    for (const id of unregistered) {
      await expect(loadRuntime(id)).rejects.toThrow(/no runtime/i);
    }
  });
});
