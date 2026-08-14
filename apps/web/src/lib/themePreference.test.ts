import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY, applyThemeChoice, readThemeChoice } from './themePreference';

// Stubbed rather than taken from the environment: this suite has no
// `localStorage` at all (measured — `typeof localStorage` is "undefined" here),
// and the module's contract is the same whether it is jsdom's, Node's, or
// absent. Duplicated rather than shared with `draft.test.ts`: a test double is
// not a feature seam, and `lib/` is for shipped pure code
// (testing-strategy.md §Conventions).
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
  delete document.documentElement.dataset.theme;
});

describe('the theme preference', () => {
  it('defaults to following the system', () => {
    expect(readThemeChoice()).toBe('system');
  });

  it('round-trips an explicit choice', () => {
    applyThemeChoice('dark');
    expect(readThemeChoice()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('REMOVES the attribute for `system` rather than stamping a third value', () => {
    // The stylesheet's unstamped state is what defers to prefers-color-scheme.
    // Stamping `data-theme="system"` would match neither themed block and leave
    // the media query outranked by nothing — the reader would be pinned to
    // whatever the bare :root says, forever, which is the opposite of "system".
    applyThemeChoice('dark');
    applyThemeChoice('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(readThemeChoice()).toBe('system');
  });

  it('ignores a stored value that is not a choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readThemeChoice()).toBe('system');
  });

  it('survives storage that throws instead of merely being empty', () => {
    // Safari in private mode, and any browser set to block site data. A theme
    // preference is not worth a blank page.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => readThemeChoice()).not.toThrow();
    expect(readThemeChoice()).toBe('system');
  });

  it('still applies the theme when persisting it is refused', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => applyThemeChoice('dark')).not.toThrow();
    // The half that matters to the reader looking at the page right now.
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
