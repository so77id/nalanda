import { Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';

import type { ThemeChoice } from '../lib/themePreference';
import { applyThemeChoice, readThemeChoice } from '../lib/themePreference';

/**
 * Three states and not two, because "follow my system" is a real preference and
 * not the absence of one. A two-way toggle silently converts a reader who never
 * chose into a reader who chose whatever they happened to be seeing, and there
 * is then no way back.
 */
const ORDER: readonly ThemeChoice[] = ['system', 'light', 'dark'];

const LABEL: Record<ThemeChoice, string> = {
  system: 'Tema: el del sistema',
  light: 'Tema: claro',
  dark: 'Tema: oscuro',
};

const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);
  const Icon = ICON[choice];

  function advance() {
    const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!;
    applyThemeChoice(next);
    setChoice(next);
  }

  return (
    <button
      type="button"
      onClick={advance}
      // The accessible name carries the CURRENT state, not the next one. A
      // screen-reader user pressing this hears what it became, which is the
      // question the control answers; "cambiar a oscuro" would leave them
      // guessing what it is now.
      aria-label={LABEL[choice]}
      title={LABEL[choice]}
      className="flex shrink-0 items-center rounded border border-rule p-2 text-ink-soft hover:bg-sunk hover:text-ink"
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  );
}
