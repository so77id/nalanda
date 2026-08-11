import { catalogEntries } from '../components';
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

/** The live catalog over every entry exported by the component features. */
export const catalog = buildCatalog(catalogEntries);
