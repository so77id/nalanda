import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { walkIndex } from './courseIndex';
import { parseFrontmatterBlock } from './documentMeta';
import { courseIndex, registry } from './liveContent';
import { unresolvedAnchors } from './questionAnchors';

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

  // Issue #139, same shape and the same reason as `presentation` above: the
  // schema defaults `questions` to 'none', so the parsed meta cannot tell "the
  // author decided this document carries no questions" from "nobody thought
  // about it". Reading the source is the only thing that can.
  //
  // Why it matters more here than a missing declaration usually does: a control
  // draws its pool from a range of sections, and a document nobody declared is
  // silently absent from every pool it should have been in. That surfaces when
  // a control is generated — which is the week it is needed, not before.
  describe('every course document declares its question coverage', () => {
    it.each(documents)('%s declares `questions`', (key) => {
      const front = parseFrontmatterBlock(readFileSync(join(APP_ROOT, key), 'utf8')) as Record<
        string,
        unknown
      > | null;
      expect(front, `no frontmatter block in ${key}`).not.toBeNull();
      expect(
        Object.hasOwn(front!, 'questions'),
        `${key} does not declare "questions". Declare per-section (every section owes one, gaps declared), pool (a set with no per-section expectation), or none.`,
      ).toBe(true);
    });
  });

  // Issue #139. A question names the section it belongs to, and that name is a
  // rendered `h2` slug (ADR-0021). The check lives here, over the source, for
  // the same reason the coverage one does: the compiled module cannot tell us
  // what the author typed.
  //
  // The suite refuses it and the BUILD DOES NOT. Drafting a question before its
  // section exists is a real order of work — only publishing one is not — so
  // `npm run build` stays green and this is what stops it shipping. The page
  // says so too: `<Question>` paints an authoring error over an anchor it
  // cannot resolve, which is the half a reader would see.
  describe('every question anchor names a section of its own document', () => {
    it.each(documents)('%s has no dangling question anchor', (key) => {
      const unresolved = unresolvedAnchors(readFileSync(join(APP_ROOT, key), 'utf8'));
      expect(
        unresolved,
        unresolved
          .map(
            ({ id, anchor }) =>
              `${key}: <Question id="${id}"> points at "${anchor}", which is not an h2 or <Slide title> of that document.`,
          )
          .join('\n'),
      ).toEqual([]);
    });
  });

  // Issue #119. Where the gate on a missing image goes, and why here.
  //
  // Rendering one is deliberately forgiving: an unresolved asset shows a broken
  // box and warns, exactly as an unresolved wiki-link does (ADR-0002), because
  // writing twenty-two slides before drawing nine diagrams is a real order of
  // work. Failing the BUILD would also take the dev server down — the integrity
  // plugin runs at `buildStart` — so an author could not preview the very
  // document they are drafting.
  //
  // But merging to main publishes the site, and a hole where a diagram belongs
  // gets projected in front of a class. So the gate sits in the suite: it does
  // not block writing, and it does block publishing (pre-PR protocol + CI).
  //
  // Deliberately a second opinion rather than a re-run of `remarkContentImages`:
  // this reads the source and touches the filesystem, so a bug in the plugin's
  // path arithmetic cannot make both agree that a missing file is fine.
  describe('every image a document references is a file that exists', () => {
    const MARKDOWN_IMAGE = /!\[[^\]]*\]\(([^)\s]+)\)/g;
    const JSX_SRC = /\bsrc=(?:"([^"]+)"|'([^']+)')/g;
    // Anything with a scheme, protocol-relative, or already rooted is not ours.
    const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i;

    function referencesIn(key: string): string[] {
      const source = readFileSync(join(APP_ROOT, key), 'utf8');
      const found = [
        ...[...source.matchAll(MARKDOWN_IMAGE)].map((m) => m[1]),
        ...[...source.matchAll(JSX_SRC)].map((m) => m[1] ?? m[2]),
      ];
      return found.filter((url) => url !== undefined && !NOT_RELATIVE.test(url));
    }

    const withImages = documents.flatMap((key) =>
      referencesIn(key).map((url) => ({ key, url }) as const),
    );

    it('finds image references to check', () => {
      expect(
        withImages.length,
        'no document references a relative image any more — either the convention changed or this regex stopped matching it; fix this before trusting the cases below',
      ).toBeGreaterThan(0);
    });

    it.each(withImages.map(({ key, url }) => [`${key} -> ${url}`, key, url] as const))(
      '%s',
      (_label, key, url) => {
        const file = join(dirname(join(APP_ROOT, key)), url);
        expect(
          existsSync(file),
          `${key} references "${url}", which is not a file. Draw it, or fix the path — it renders as a broken box and would ship that way.`,
        ).toBe(true);
      },
    );
  });

  // Issue #119 (review CT-3). Alt is required and in Spanish (root CLAUDE.md: the
  // page is lang="es", so an accessible name is announced with Spanish phonemes).
  // `<Figure>` enforces this at runtime, but a markdown image `![](./x.svg)`
  // routes through `MdxImage`, which passes alt straight through — so an empty-alt
  // markdown image would ship an unnamed picture past every gate. The one
  // documented exception (`alt=""`) lives inside a `<Mosaic>` cell, a JSX-only
  // affordance; markdown has no Mosaic, so every relative markdown image must
  // name itself. Reads the source and ships at publish-time weight, like the
  // file-existence gate above.
  describe('every relative markdown image names itself', () => {
    const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
    // Anything with a scheme, protocol-relative, or already rooted is not ours.
    const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i;

    const markdownImages = documents.flatMap((key) => {
      const source = readFileSync(join(APP_ROOT, key), 'utf8');
      return [...source.matchAll(MARKDOWN_IMAGE)]
        .filter((m) => !NOT_RELATIVE.test(m[2]!))
        .map((m) => ({ key, alt: m[1]!, url: m[2]! }));
    });

    it('finds markdown images to check', () => {
      expect(
        markdownImages.length,
        'no document uses relative markdown image syntax any more — if the convention moved to <Figure> only, drop this block; otherwise the regex stopped matching it',
      ).toBeGreaterThan(0);
    });

    it.each(markdownImages.map(({ key, alt, url }) => [`${key} -> ${url}`, alt] as const))(
      '%s',
      (_label, alt) => {
        expect(
          alt.trim(),
          'a markdown image with empty alt ships an unnamed picture — write its alt in Spanish, or use <Figure> if it belongs on a slide',
        ).not.toBe('');
      },
    );
  });
});
