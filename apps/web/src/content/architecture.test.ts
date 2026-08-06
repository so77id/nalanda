import { describe, expect, it } from 'vitest';

import { walkIndex } from './courseIndex';
import { courseIndex, registry } from './liveContent';

// L4 invariants over the live content/ tree (testing-strategy.md): unique ids
// and index integrity. Importing liveContent re-runs all fail-fast validation.
describe('architecture: content invariants', () => {
  it('the registry builds and every entry is retrievable by its id', () => {
    expect(registry.entries.length).toBeGreaterThan(0);
    for (const entry of registry.entries) {
      expect(registry.get(entry.meta.id)).toBe(entry);
    }
  });

  it('the course index exists and every referenced docId resolves in the registry', () => {
    const ids = walkIndex(courseIndex);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(registry.get(id), `index references unknown doc "${id}"`).toBeDefined();
    }
  });
});
