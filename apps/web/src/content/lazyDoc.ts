import { lazy } from 'react';
import type { ComponentType } from 'react';

import type { RegistryEntry } from './registry';

type DocComponent = ComponentType<{ components?: Record<string, ComponentType> }>;

// lazy() must be called once per document, not per render, or React remounts
// the tree. Shared by the book page and the presentation page so both routes
// reuse the same loaded chunk.
const cache = new Map<string, DocComponent>();

/** The lazy React component of a registry entry (per-document cache). */
export function lazyDocumentComponent(entry: RegistryEntry): DocComponent {
  let cached = cache.get(entry.meta.id);
  if (!cached) {
    cached = lazy(entry.load) as unknown as DocComponent;
    cache.set(entry.meta.id, cached);
  }
  return cached;
}
