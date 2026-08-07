import { catalogEntries } from '../components';
import type { CatalogEntry, CatalogFamily } from '../lib/catalogEntry';

export interface Catalog {
  entries: CatalogEntry[];
  byName(name: string): CatalogEntry | undefined;
  byFamily(family: CatalogFamily): CatalogEntry[];
}

/** Builds the catalog index; throws on duplicate names (fail-fast, like the content registry). */
export function buildCatalog(entries: CatalogEntry[]): Catalog {
  const byName = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    if (byName.has(entry.name)) {
      throw new Error(`Catalog: duplicate catalog entry "${entry.name}"`);
    }
    byName.set(entry.name, entry);
  }
  return {
    entries,
    byName: (name) => byName.get(name),
    byFamily: (family) => entries.filter((e) => e.family === family),
  };
}

/** The live catalog over every entry exported by the component features. */
export const catalog = buildCatalog(catalogEntries);
