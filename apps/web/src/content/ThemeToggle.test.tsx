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

  it('reports the choice a previous visit left stamped on the document', () => {
    // Stamped, not stored. The pre-paint script in index.html turns storage into
    // the stamp before React runs, so the stamp is what the reader can see.
    document.documentElement.dataset.theme = 'dark';
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Tema: oscuro');
  });

  it('reports what is PAINTED, not what is stored, when the two disagree', () => {
    // The regression that shipped and was caught in a browser (#109 review):
    // seeded from storage, a reader whose saved 'light' never reached the DOM —
    // a CSP without 'unsafe-inline', a proxy stripping inline scripts, a drifted
    // key — saw a black page with a sun icon labelled "Tema: claro", and the
    // first click advanced PAST light, so light took three clicks to reach.
    //
    // Storage says light; nothing is stamped, so the page is on the OS theme.
    // The label must say so, and one click must reach light.
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Tema: el del sistema');
  });

  it('names the CURRENT theme, not the next one', () => {
    // A screen-reader user pressing this hears what it became, which is the
    // question the control answers. "Cambiar a oscuro" would leave them without
    // the one fact the control exists to report.
    document.documentElement.dataset.theme = 'light';
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Tema: claro');
  });

  it('keeps the label and the stamped document in step through a full cycle', async () => {
    // The label and the DOM are the two things that disagreed, so this pins both
    // at every step — asserting only the name is what let them drift.
    //
    // userEvent, not element.click(): a bare click runs the handler (which writes
    // the DOM) without flushing React's re-render, so the label lags one step and
    // the case fails against correct code. Worth stating because that failure
    // looks exactly like the bug it is testing for.
    const label: Record<string, string | undefined> = {
      'Tema: el del sistema': undefined,
      'Tema: claro': 'light',
      'Tema: oscuro': 'dark',
    };
    const user = userEvent.setup();
    render(<ThemeToggle />);
    for (let i = 0; i < 4; i += 1) {
      const button = screen.getByRole('button');
      const name = button.getAttribute('aria-label')!;
      expect(document.documentElement.dataset.theme, `label said "${name}"`).toBe(label[name]);
      await user.click(button);
    }
  });
});
