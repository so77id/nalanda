import { ASSET_PREFIX } from './assetPrefix';

/**
 * Every `.java` file under `content/`, as text, keyed by its path from the
 * content root — the files a course keeps beside a document so its listings
 * quote one copy instead of pasting many (ADR-0091).
 *
 * Eager, and imported only by the listing widgets (`<StepShow>`,
 * `<SourceFile>`), which ship behind their lazy wrappers: the text rides in
 * their chunk, never in the entry one. A course's sources are a few kilobytes.
 */
const sources = import.meta.glob('@content/**/*.java', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const byKey = new Map(
  Object.entries(sources).map(([path, text]) => [path.replace(/^(?:\.\.\/)*content\//, ''), text]),
);

/**
 * The text of a file a document names (`asset:courses/…/Graph.java`, as
 * `remarkContentImages` rewrites a `codeSrc`), or `null` when nothing under
 * `content/` matches — the caller says so on the page.
 */
export function resolveCode(src: string): string | null {
  if (!src.startsWith(ASSET_PREFIX)) return null;
  return byKey.get(src.slice(ASSET_PREFIX.length)) ?? null;
}
