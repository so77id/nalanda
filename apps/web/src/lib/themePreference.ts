export type ThemeChoice = 'light' | 'dark' | 'system';

/** Also spelled in the inline script in index.html. Changing it here changes it
 *  there — the script cannot import this module, because it has to run before
 *  any module does. */
export const THEME_STORAGE_KEY = 'nalanda:theme';

function isChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * What the reader has chosen, or `system` when they have not.
 *
 * Storage can throw rather than merely be empty — Safari in private mode, a
 * browser set to block site data — and in this suite it is absent altogether, so
 * access goes through `globalThis.localStorage?.` exactly as `draft.ts` does. A
 * theme preference is not worth a blank page: every failure resolves to
 * `system`, which is also the correct default.
 */
export function readThemeChoice(): ThemeChoice {
  try {
    const stored: unknown = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return isChoice(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Persist the choice and apply it to the document.
 *
 * `system` REMOVES the attribute rather than storing a third value on the root:
 * the stylesheet's unstamped state is what defers to `prefers-color-scheme`, so
 * stamping anything at all would defeat it. That asymmetry — three choices, two
 * attribute values — is the whole reason this lives in one function instead of
 * at each call site.
 */
export function applyThemeChoice(choice: ThemeChoice): void {
  // Apply first, persist second, and the order is deliberate: a storage refusal
  // must not undo the theme the reader just asked for. Do not move the DOM
  // writes inside the try.
  if (choice === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = choice;
  }
  syncThemeColour(choice);
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // The theme still applied; only its persistence was refused. Failing loudly
    // here would take down the page for a preference.
  }
}

/**
 * Keep the phone's chrome on the theme the reader is actually seeing.
 *
 * `index.html` ships two `theme-color` metas keyed on `prefers-color-scheme`,
 * which only ever asks the OS. Nothing about an explicit choice reaches them, so
 * a reader on a light OS who picks dark got a light phone chrome around a dark
 * page — the exact "one theme's colour inside the other" defect this whole WP
 * exists to remove, reintroduced on the axis the WP itself added (#109 review,
 * measured in a browser).
 *
 * `media` is rewritten rather than the tags replaced: flipping which query each
 * meta answers is what makes the browser honour the chosen one, and restoring
 * the original queries hands control back to the OS for `system`.
 */
function syncThemeColour(choice: ThemeChoice): void {
  const metas = document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  for (const meta of metas) {
    const its = meta.dataset.scheme ?? (meta.media.includes('dark') ? 'dark' : 'light');
    // Remembered on the element, because the media attribute is what we rewrite.
    meta.dataset.scheme = its;
    meta.media =
      choice === 'system'
        ? `(prefers-color-scheme: ${its})`
        : // `all` for the chosen one, a query nothing matches for the other.
          its === choice
          ? 'all'
          : 'not all';
  }
}
