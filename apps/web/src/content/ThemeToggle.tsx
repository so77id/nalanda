import { Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';

import type { ThemeChoice } from '../lib/themePreference';
import { applyThemeChoice } from '../lib/themePreference';

/** What the document is actually stamped with — the theme the reader can SEE.
 *  No stamp means the page is deferring to the OS, which is `system`. */
function stampedChoice(): ThemeChoice {
  const stamped = document.documentElement.dataset.theme;
  return stamped === 'light' || stamped === 'dark' ? stamped : 'system';
}

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
  // Seeded from the DOM, not from storage. Those are two sources of truth, and
  // they disagree whenever the pre-paint script in index.html does not run — a
  // CSP without 'unsafe-inline', a proxy that strips inline scripts, or a
  // one-character drift in the key it spells twice. Reading storage there gave a
  // black page with a sun icon labelled "Tema: claro" (measured in a browser,
  // #109 review), and the first click advanced PAST light, so getting back to it
  // took three clicks. Seeded from the DOM the label cannot lie: it reports what
  // is painted, and light is one click away.
  const [choice, setChoice] = useState<ThemeChoice>(stampedChoice);
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
