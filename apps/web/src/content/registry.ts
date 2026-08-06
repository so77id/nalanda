import type { ComponentType } from 'react';

/** Frontmatter contract every content document must satisfy (issue #63, ADR-0002). */
export interface DocumentMeta {
  id: string;
  title: string;
}

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

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseMeta(sourcePath: string, raw: unknown): DocumentMeta {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Content registry: no frontmatter found in ${sourcePath}`);
  }
  const { id, title } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`Content registry: missing frontmatter "id" in ${sourcePath}`);
  }
  if (!KEBAB_CASE.test(id)) {
    throw new Error(
      `Content registry: id "${id}" is not kebab-case (lowercase words separated by "-") in ${sourcePath}`,
    );
  }
  if (typeof title !== 'string' || title === '') {
    throw new Error(`Content registry: missing frontmatter "title" in ${sourcePath}`);
  }
  return { id, title };
}

/**
 * Builds the id → document index from the glob maps. Throws (failing dev
 * startup and the verification battery) on invalid frontmatter or duplicate ids.
 */
export function buildRegistry(
  metaModules: Record<string, unknown>,
  loaders: Record<string, () => Promise<unknown>>,
): ContentRegistry {
  const byId = new Map<string, RegistryEntry>();
  for (const [sourcePath, raw] of Object.entries(metaModules)) {
    const meta = parseMeta(sourcePath, raw);
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

/** The live registry over the real content/ tree. */
export const registry = buildRegistry(
  import.meta.glob('@content/courses/**/*.mdx', { eager: true, import: 'frontmatter' }),
  import.meta.glob('@content/courses/**/*.mdx'),
);
