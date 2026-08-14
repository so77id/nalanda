import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { walkIndex } from './courseIndex';
import { parseFrontmatterBlock } from './documentMeta';
import { courseIndex, registry } from './liveContent';

// The document list comes from the same glob `liveContent.ts` uses, so this
// invariant covers exactly the set the app ships — no more and no less. A
// directory walk of its own drifts from that set in both directions: it follows
// a symlinked directory out of the tree, and it drops a symlinked `.mdx` the
// glob (and therefore the registry) does publish.
//
// The BODY still reads the file, and two measured facts say it has to:
//   - `parseDocumentMeta` normalises an absent `presentation` to 'auto', so the
//     parsed meta cannot tell "declared auto" from "never declared" — and that
//     difference is the entire point of the invariant below. The `?frontmatter`
//     virtual module goes through the same normaliser, so it is no better.
//   - `import.meta.glob(..., { query: '?raw' })` does NOT return the source
//     here: the MDX plugin claims the file first, so the glob hands back the
//     compiled `MDXContent` function. A frontmatter regex over that finds
//     nothing and every case fails with "no frontmatter block", which looks
//     like the invariant working and is not.
//
// Glob keys are relative to the Vite root, so they are resolved against this
// file rather than the cwd. `fileURLToPath(import.meta.url)` is fine on its own
// — it is the `new URL(x, import.meta.url)` PATTERN that Vite rewrites into an
// asset URL, and only that pattern throws.
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const documents = Object.keys(import.meta.glob('@content/courses/**/*.mdx'));

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
  // Registry-driven per testing-strategy.md: one case per document the glob
  // finds, so a new document is gated the moment it lands, with the non-vacuity
  // guard naming what to do if it ever trips.
  describe('every course document declares how it presents', () => {
    it('finds documents to check', () => {
      expect(
        documents.length,
        'the @content glob matched no .mdx — the content tree moved; repoint it before trusting the cases below',
      ).toBeGreaterThan(0);
    });

    it.each(documents)('%s declares `presentation`', (key) => {
      const front = parseFrontmatterBlock(readFileSync(join(APP_ROOT, key), 'utf8')) as Record<
        string,
        unknown
      > | null;
      expect(front, `no frontmatter block in ${key}`).not.toBeNull();
      expect(
        Object.hasOwn(front!, 'presentation'),
        `${key} does not declare "presentation". It still ships a deck (the default is 'auto') — one nobody chose. Declare auto, explicit or none.`,
      ).toBe(true);
    });
  });
});
