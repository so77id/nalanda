import { useSyncExternalStore } from 'react';

export type ResolvedTheme = 'light' | 'dark';

const PREFERS_DARK = '(prefers-color-scheme: dark)';

function ask(): MediaQueryList | null {
  // jsdom implements no media query at all, so the guard is what keeps the suite
  // from throwing on a question only a browser can answer (testing-strategy.md
  // §Layout and focus). Same shape as `usePortraitPhone`.
  return typeof window.matchMedia === 'function' ? window.matchMedia(PREFERS_DARK) : null;
}

function subscribe(onChange: () => void): () => void {
  const query = ask();
  query?.addEventListener('change', onChange);

  // The attribute half: an explicit choice stamps `data-theme` on the root, and
  // nothing about that fires a media-query event. Without this the CSS would
  // switch and anything reading the theme in JS would not — which is precisely
  // the split the tokens exist to avoid.
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(onChange) : null;
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  return () => {
    query?.removeEventListener('change', onChange);
    observer?.disconnect();
  };
}

function snapshot(): ResolvedTheme {
  // Same precedence as the stylesheet, and it has to stay the same: an explicit
  // choice wins over the OS, and with no choice the OS decides. If these two
  // disagree, CSS paints one theme while a themed JS component renders the
  // other — inside the same panel.
  const stamped = document.documentElement.dataset.theme;
  if (stamped === 'light' || stamped === 'dark') return stamped;
  return ask()?.matches ? 'dark' : 'light';
}

/**
 * The theme actually in force, for the few components that cannot be styled
 * through CSS alone.
 *
 * This exists for CodeMirror, which takes a theme as a prop rather than reading
 * the cascade, so `theme="dark"` left a dark editor embedded in a light panel.
 * Reach for it only when a third-party component owns its own colours; anything
 * we style ourselves takes the tokens and needs no hook at all.
 *
 * `useSyncExternalStore` rather than useState + an effect, for the reason
 * `usePortraitPhone` documents: React re-reads the snapshot after subscribing,
 * which closes the render-to-effect gap by construction.
 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, snapshot, () => 'light');
}
