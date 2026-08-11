import { describe, expect, it } from 'vitest';

import type { EditorVariant } from './variants';
import { FLAG_NAMES, resolveFlags } from './variants';

const VARIANTS: EditorVariant[] = ['minimal', 'snippet', 'read', 'exercise', 'lab'];

describe('resolveFlags', () => {
  it.each(VARIANTS)('%s resolves every flag to a boolean', (variant) => {
    const flags = resolveFlags(variant);
    // A missing flag would render as `undefined` and silently hide chrome.
    for (const name of FLAG_NAMES) {
      expect(typeof flags[name]).toBe('boolean');
    }
  });

  it('lets an explicit prop win over the preset', () => {
    expect(resolveFlags('exercise').showStdin).toBe(false);
    expect(resolveFlags('exercise', { showStdin: true }).showStdin).toBe(true);
    expect(resolveFlags('lab', { runnable: false }).runnable).toBe(false);
  });

  it('keeps reading variants inert', () => {
    for (const variant of ['minimal', 'snippet', 'read'] as const) {
      const flags = resolveFlags(variant);
      expect(flags.runnable).toBe(false);
      expect(flags.editable).toBe(false);
      // AC6: nothing that cannot run should be able to pull in a compiler.
      expect(flags.warmOnMount).toBe(false);
    }
  });

  it('only warms on mount where a class is about to run code', () => {
    expect(resolveFlags('lab').warmOnMount).toBe(true);
    expect(resolveFlags('exercise').warmOnMount).toBe(false);
  });

  it('gives lab every panel exercise has', () => {
    const exercise = resolveFlags('exercise');
    const lab = resolveFlags('lab');
    for (const name of FLAG_NAMES) {
      if (exercise[name]) expect(lab[name]).toBe(true);
    }
  });
});
