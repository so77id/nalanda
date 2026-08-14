/**
 * What the reader stares at while the editor chunk arrives.
 *
 * Its own module rather than an export of the wrapper: a file that exports both
 * a component and a function loses fast refresh, and the family-private helper
 * beside its family is the shape this repo already uses (`Panel`,
 * `useRunShortcut`). Exported because it is the whole of the rule and the only
 * part a test can reach — React resolves the lazy import before any assertion
 * in jsdom, so the fallback is never in the tree when a rendering test looks.
 */
export function placeholderClass(embedded: boolean): string {
  return embedded
    ? 'h-40 animate-pulse bg-surface'
    : 'not-prose my-6 h-40 animate-pulse rounded-lg border border-rule bg-surface';
}
