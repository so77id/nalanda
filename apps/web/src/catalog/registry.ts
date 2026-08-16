import { loadCatalogEntries } from '../components';
import type { CatalogEntry, CatalogFamily } from '../lib/catalogEntry';

export interface Catalog {
  entries: readonly CatalogEntry[];
  byName(name: string): CatalogEntry | undefined;
  byFamily(family: CatalogFamily): CatalogEntry[];
}

/** Builds the catalog index; throws on duplicate names (fail-fast, like the content registry). */
export function buildCatalog(entries: readonly CatalogEntry[]): Catalog {
  // Snapshot: later mutation of the caller's array must not desynchronize the
  // name index from the family lists (nor bypass the duplicate check).
  const all: readonly CatalogEntry[] = Object.freeze([...entries]);
  const byName = new Map<string, CatalogEntry>();
  for (const entry of all) {
    if (byName.has(entry.name)) {
      throw new Error(`Catalog: duplicate catalog entry "${entry.name}"`);
    }
    byName.set(entry.name, entry);
  }
  return {
    entries: all,
    byName: (name) => byName.get(name),
    byFamily: (family) => all.filter((e) => e.family === family),
  };
}

/**
 * The live catalog over every entry the component features ship.
 *
 * One memoised promise, not a fresh one per call: `use()` identifies a resource
 * BY the promise, so a page that built its own would suspend forever, and the
 * entries would be fetched once per catalog page rather than once per session.
 * Created on first call rather than at module scope — the shell imports this
 * module eagerly for `families`, and a top-level call would fetch the entries
 * before the first paint, which is the whole thing #122 removed.
 */
let pending: Promise<Catalog> | null = null;

export function loadCatalog(): Promise<Catalog> {
  return (pending ??= loadCatalogEntries().then(buildCatalog));
}
