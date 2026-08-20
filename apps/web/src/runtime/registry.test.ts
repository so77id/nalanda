import { describe, expect, it } from 'vitest';

import type { RuntimeId } from './contract';
import { RUNTIME_IDS } from './contract';
import { descriptorOf, loadGrammar, loadRuntime, runtimeDescriptors } from './registry';

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
    },
  );

  // A separate entry point from `loadRuntime`, and separately gated, because
  // the whole point is that a consumer can have one without the other. The
  // historical worked case (retired in #209): a memory-diagram widget drove
  // a JVM and drew its own listing, so it paid for a grammar it never
  // rendered (#122; the bytes are in ADR-0018 §4).
  // "Of its OWN" is the assertion, not "a grammar". `toBeDefined()` alone let a
  // review recheck swap the java and python arms of the switch with all 997 cases
  // green — every Java listing on the site highlighted as Python, silently and
  // site-wide. A grammar knows its own name; ask it.
  it.each(runtimeDescriptors)('$id loads a grammar of its own', async ({ id }) => {
    const extension = (await loadGrammar(id)) as { language?: { name?: string } };
    expect(extension).toBeDefined();
    expect(extension.language?.name).toBe(id === 'cpp' ? 'cpp' : id);
  });

  it('fails loudly for a language that has no grammar', async () => {
    await expect(loadGrammar('rust' as RuntimeId)).rejects.toThrow(/no grammar/i);
  });

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
