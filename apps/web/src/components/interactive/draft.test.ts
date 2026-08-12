import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDraft, draftKey, readDraft, saveDraft } from './draft';

// Stubbed rather than taken from the environment: this suite runs where
// `localStorage` may be jsdom's, Node's experimental one, or absent entirely,
// and the module's contract is the same in all three.
function fakeStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('draftKey', () => {
  it('is stable for the same scope and seed', () => {
    expect(draftKey('/d/java', 'class A {}')).toBe(draftKey('/d/java', 'class A {}'));
  });

  it('separates two editors that start from different code', () => {
    expect(draftKey('/d/java', 'class A {}')).not.toBe(draftKey('/d/java', 'class B {}'));
  });

  it('separates the same exercise on two different pages', () => {
    expect(draftKey('/d/uno', 'class A {}')).not.toBe(draftKey('/d/dos', 'class A {}'));
  });
});

describe('draft storage', () => {
  it('round-trips what was saved', () => {
    const key = draftKey('/d/java', 'seed');
    saveDraft(key, 'lo que escribí');
    expect(readDraft(key)).toBe('lo que escribí');
  });

  it('reads null when nothing was saved', () => {
    expect(readDraft(draftKey('/d/java', 'nunca'))).toBeNull();
  });

  it('forgets a cleared draft', () => {
    const key = draftKey('/d/java', 'seed');
    saveDraft(key, 'algo');
    clearDraft(key);
    expect(readDraft(key)).toBeNull();
  });

  it('keeps two editors apart', () => {
    saveDraft(draftKey('/d/java', 'uno'), 'primero');
    saveDraft(draftKey('/d/java', 'dos'), 'segundo');
    expect(readDraft(draftKey('/d/java', 'uno'))).toBe('primero');
  });

  it('survives storage that throws', () => {
    // Safari private browsing is the usual culprit, a full quota the other.
    // Losing a draft is bad; taking the page down over it is worse.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });

    const key = draftKey('/d/java', 'seed');
    expect(() => saveDraft(key, 'algo')).not.toThrow();
    expect(() => clearDraft(key)).not.toThrow();
    expect(readDraft(key)).toBeNull();
  });

  it('survives an environment with no storage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    const key = draftKey('/d/java', 'seed');
    expect(() => saveDraft(key, 'algo')).not.toThrow();
    expect(readDraft(key)).toBeNull();
  });
});
