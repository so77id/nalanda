import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useResolvedTheme } from './useResolvedTheme';

// Answers only the question it was written for. A fake that returned the same
// `matches` for every query would also be telling framer-motion that reduced
// motion is on, for the rest of the file (#91 review). Duplicated rather than
// shared with the other matchMedia fakes in the suite: a cross-feature import may
// only go through a feature seam, and a test double is not one
// (testing-strategy.md §Conventions).
function prefersDark(dark: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: query.includes('prefers-color-scheme: dark') && dark,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
  delete document.documentElement.dataset.theme;
});

describe('useResolvedTheme', () => {
  // These four cases ARE the contract, and the contract is that this hook and
  // the stylesheet resolve the theme identically. If they ever disagree the CSS
  // paints one theme while CodeMirror renders the other, inside the same panel —
  // which is the exact defect the hook was added to fix, only harder to see.
  it('follows the OS when nothing is stamped', () => {
    prefersDark(true);
    expect(renderHook(() => useResolvedTheme()).result.current).toBe('dark');
  });

  it('follows the OS the other way too', () => {
    prefersDark(false);
    expect(renderHook(() => useResolvedTheme()).result.current).toBe('light');
  });

  it('lets an explicit light choice beat a dark OS', () => {
    // The `:root:not([data-theme='light'])` guard on the media query, in JS.
    prefersDark(true);
    document.documentElement.dataset.theme = 'light';
    expect(renderHook(() => useResolvedTheme()).result.current).toBe('light');
  });

  it('lets an explicit dark choice beat a light OS', () => {
    // The `:root[data-theme='dark']` block, in JS.
    prefersDark(false);
    document.documentElement.dataset.theme = 'dark';
    expect(renderHook(() => useResolvedTheme()).result.current).toBe('dark');
  });

  it('falls back to light where the question cannot be asked', () => {
    // jsdom without the fake, and the server snapshot. Light is the bare `:root`
    // block — the same fallback the stylesheet has.
    expect(renderHook(() => useResolvedTheme()).result.current).toBe('light');
  });

  it('ignores a stamped value that is not a theme', () => {
    prefersDark(true);
    document.documentElement.dataset.theme = 'sepia';
    expect(renderHook(() => useResolvedTheme()).result.current).toBe('dark');
  });
});
