import { ASSET_PREFIX } from './assetPrefix';

/**
 * Every image under `content/`, keyed by its path from the content root.
 *
 * Eager on purpose: what a `?url` import yields is a short string, so the map
 * costs the reader a handful of bytes per asset and nothing is fetched until an
 * `<img>` asks for it. It is also what makes the base path correct — Vite
 * rewrites these urls for `/nalanda/`, which a literal path in a document never
 * gets. `lib/` and not `content/` because `components/` resolves the same keys
 * and may not import a sibling feature.
 */
const assetUrls = import.meta.glob('@content/**/*.{svg,png,jpg,jpeg,webp,avif,gif}', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Glob keys arrive relative to this module (`../../content/courses/…`); the
// content root is the anchor every document's key is written against.
const byKey = new Map(
  Object.entries(assetUrls).map(([path, url]) => [path.replace(/^(?:\.\.\/)*content\//, ''), url]),
);

/**
 * The built url for an `asset:` reference, or `null` when nothing under
 * `content/` matches — the caller renders that visibly broken, the way an
 * unresolved wiki-link does.
 */
export function resolveAsset(src: string): string | null {
  if (!src.startsWith(ASSET_PREFIX)) return null;
  return byKey.get(src.slice(ASSET_PREFIX.length)) ?? null;
}
