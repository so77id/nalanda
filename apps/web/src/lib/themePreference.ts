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
  if (choice === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = choice;
  }
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // The theme still applied; only its persistence was refused. Failing loudly
    // here would take down the page for a preference.
  }
}
