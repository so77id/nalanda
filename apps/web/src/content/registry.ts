import type { ComponentType } from 'react';

import { parseDocumentMeta } from './documentMeta';
import type { DocumentMeta } from './documentMeta';

export type { DocumentMeta } from './documentMeta';

export interface RegistryEntry {
  meta: DocumentMeta;
  /** Serialization detail only — identity is meta.id (ADR-0002). Used in error messages. */
  sourcePath: string;
  load: () => Promise<{ default: ComponentType }>;
}

export interface ContentRegistry {
  entries: RegistryEntry[];
  get(id: string): RegistryEntry | undefined;
}

/**
 * Builds the id → document index from the glob maps. Throws on invalid
 * frontmatter or duplicate ids — the same contract the contentIntegrity Vite
 * plugin enforces at build time; this runtime layer covers dev and the battery.
 */
export function buildRegistry(
  metaModules: Record<string, unknown>,
  loaders: Record<string, () => Promise<unknown>>,
): ContentRegistry {
  const byId = new Map<string, RegistryEntry>();
  for (const [sourcePath, raw] of Object.entries(metaModules)) {
    const meta = parseDocumentMeta(sourcePath, raw);
    const existing = byId.get(meta.id);
    if (existing) {
      throw new Error(
        `Content registry: duplicate document id "${meta.id}" in ${existing.sourcePath} and ${sourcePath}`,
      );
    }
    const load = loaders[sourcePath];
    if (!load) {
      throw new Error(`Content registry: no loader for ${sourcePath} (glob mismatch)`);
    }
    byId.set(meta.id, {
      meta,
      sourcePath,
      load: load as RegistryEntry['load'],
    });
  }
  return {
    entries: [...byId.values()],
    get: (id) => byId.get(id),
  };
}
