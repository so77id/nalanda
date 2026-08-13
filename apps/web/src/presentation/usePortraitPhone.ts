import { useEffect, useState } from 'react';

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

/** True while the reader holds a touch device upright. False anywhere it cannot be asked. */
export function usePortraitPhone(): boolean {
  const [matches, setMatches] = useState(() => ask()?.matches ?? false);

  useEffect(() => {
    const query = ask();
    if (!query) return;
    // Re-read on mount: the phone can have been turned between the first render
    // and this effect, and the `change` event for it is already gone.
    setMatches(query.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return matches;
}
