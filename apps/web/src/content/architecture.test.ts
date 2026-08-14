import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { walkIndex } from './courseIndex';
import { parseFrontmatterBlock } from './documentMeta';
import { courseIndex, registry } from './liveContent';

// Read from disk, not through the registry and not through a `?raw` glob.
//
// Two reasons, and each one was measured rather than assumed:
//   - `parseDocumentMeta` normalises an absent `presentation` to 'auto', so the
//     parsed meta cannot tell "declared auto" from "never declared" — and that
//     difference is the entire point of the invariant below.
//   - `import.meta.glob(..., { query: '?raw' })` does NOT return the source
//     here: the MDX plugin claims the file first, so the glob hands back the
//     compiled `MDXContent` function. A frontmatter regex over that finds
//     nothing and every case fails with "no frontmatter block", which looks
//     like the invariant working and is not.
// Resolved from the Vitest root (apps/web), not from import.meta.url: under
// Vite's SSR transform that is an http: URL, and fileURLToPath rejects it.
const COURSES = join(process.cwd(), '../../content/courses');

function mdxFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.mdx'))
    .map((e) => join(e.parentPath, e.name));
}

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

  // Issue #108. `presentation` is optional in the schema and defaults to 'auto',
  // so a document that never declares it still ships a deck — one its author has
  // never seen. The schema keeps the default (a platform where most documents
  // should be presentable wants it); this invariant is about authored intent, and
  // it is the only thing that can tell the two apart.
  //
  // Registry-driven per testing-strategy.md: one case per document found, so a
  // new document is gated the moment it lands, with the non-vacuity guard naming
  // what to do if it ever trips.
  describe('every course document declares how it presents', () => {
    const files = mdxFilesUnder(COURSES);

    it('finds documents to check', () => {
      expect(
        files.length,
        'no .mdx found under content/courses — the tree moved; repoint COURSES before trusting the cases below',
      ).toBeGreaterThan(0);
    });

    it.each(files)('%s declares `presentation`', (file) => {
      const where = relative(COURSES, file);
      const front = parseFrontmatterBlock(readFileSync(file, 'utf8')) as Record<
        string,
        unknown
      > | null;
      expect(front, `no frontmatter block in ${where}`).not.toBeNull();
      expect(
        Object.hasOwn(front!, 'presentation'),
        `${where} does not declare "presentation". It still ships a deck (the default is 'auto') — one nobody chose. Declare auto, explicit or none.`,
      ).toBe(true);
    });
  });
});
