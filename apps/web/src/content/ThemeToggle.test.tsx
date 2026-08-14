import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeToggle } from './ThemeToggle';
import { THEME_STORAGE_KEY } from '../lib/themePreference';

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

describe('ThemeToggle', () => {
  it('starts on the system theme and says so', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Tema: el del sistema' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('cycles system → light → dark → system', async () => {
    // Three states, because "follow my system" is a preference and not the
    // absence of one. A two-way toggle turns a reader who never chose into a
    // reader who chose whatever they were seeing, with no way back.
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = () => screen.getByRole('button');

    await user.click(button());
    expect(button()).toHaveAccessibleName('Tema: claro');
    expect(document.documentElement.dataset.theme).toBe('light');

    await user.click(button());
    expect(button()).toHaveAccessibleName('Tema: oscuro');
    expect(document.documentElement.dataset.theme).toBe('dark');

    await user.click(button());
    expect(button()).toHaveAccessibleName('Tema: el del sistema');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('is reachable and operable from the keyboard', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('restores a choice made on an earlier visit', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Tema: oscuro');
  });

  it('names the CURRENT theme, not the next one', () => {
    // A screen-reader user pressing this hears what it became, which is the
    // question the control answers. "Cambiar a oscuro" would leave them without
    // the one fact the control exists to report.
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Tema: claro');
  });
});
