import { useSyncExternalStore } from 'react';

// Coarse pointer AND portrait, in one query. The pointer half is what keeps a
// narrow or tall window on a laptop out of it: that is not a phone, and telling
// its user to turn their screen sideways is worse than the layout ever was.
const PHONE_IN_PORTRAIT = '(pointer: coarse) and (orientation: portrait)';

function ask(): MediaQueryList | null {
  // jsdom does not implement matchMedia at all, so the guard is what keeps the
  // suite from throwing on a question the browser is the only one who can
  // answer (testing-strategy.md §Layout and focus).
  return typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_IN_PORTRAIT) : null;
}

function subscribe(onChange: () => void): () => void {
  const query = ask();
  if (!query) return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function matches(): boolean {
  return ask()?.matches ?? false;
}

/**
 * True while the reader holds a touch device upright. False anywhere it cannot
 * be asked.
 *
 * useSyncExternalStore rather than useState + an effect: React re-reads the
 * snapshot after subscribing, which closes the render-to-effect gap by
 * construction. Doing it by hand needs an extra re-read whose only possible
 * test asserts render/effect ordering — an implementation detail, which
 * `apps/web/CLAUDE.md` rules out of component tests (#91 review).
 */
export function usePortraitPhone(): boolean {
  return useSyncExternalStore(subscribe, matches);
}
