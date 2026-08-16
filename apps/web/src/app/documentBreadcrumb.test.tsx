import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { courseIndex, registry, walkIndex } from '../content';

import { AppRoutes } from './AppRoutes';

// Page-level, and therefore here rather than in content/: a document body may
// use any shell-registered component (<SectionBreak/>, <Exercise>...), and those
// resolve only through the shell's MDX map. Mounted with a feature-local map,
// these tests pass or fail depending on whether the lazy document chunk wins the
// race against the assertion — which is exactly how they were first written, and
// how they flaked (1 run in 3) before moving here.
function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

// The live course, so the breadcrumb is asserted against the index that ships.
const nestedId = walkIndex(courseIndex).find(
  (id) => courseIndex.entries.find((e) => e.children?.some((c) => c.docId === id)) !== undefined,
)!;

describe('the breadcrumb row of a document', () => {
  it('the seed course provides a document nested under a group', () => {
    expect(nestedId).toBeDefined();
  });

  it('places the document in the course and its unit', async () => {
    renderAt(`/d/${nestedId}`);
    const nav = await screen.findByRole('navigation', { name: /ubicaci/i });
    expect(nav).toHaveTextContent(courseIndex.title!);
    expect(nav).toHaveTextContent(/\d+ de \d+/);
  });

  it('keeps Presentar in the same row as the breadcrumb, not floating alone', async () => {
    renderAt(`/d/${nestedId}`);
    const nav = await screen.findByRole('navigation', { name: /ubicaci/i });
    const presentar = screen.getByRole('link', { name: /presentar/i });
    // Sharing the row is the whole point of the slice — a link floating in the
    // corner attached to nothing is what it replaces.
    expect(nav.closest('div')?.parentElement).toContainElement(presentar);
  });

  it('drops the arrow glyph the rest of the product does not use', async () => {
    renderAt(`/d/${nestedId}`);
    const presentar = await screen.findByRole('link', { name: /presentar/i });
    expect(presentar.textContent).not.toContain('▸');
    expect(presentar.querySelector('svg')).not.toBeNull();
  });

  // Every document is on the teaching path, and this is what says so.
  //
  // Two cases lived here from #136 until #135: this set assertion, and a
  // rendering one that showed an unlisted document gets the course crumb and no
  // position. The rendering case is retired — it needed a real unlisted document
  // as its fixture, and keeping one off the index to serve a test is inventing
  // content for the suite (ADR-0025). Its contract is covered at unit level by
  // `content/courseIndex.test.ts` (trailFor) and `content/Breadcrumb.test.tsx`,
  // both over synthetic trails.
  //
  // This one stays, because it never needed a fixture. #136 added it as a named
  // allowlist because three documents were deliberately off the path; with that
  // set empty it is simply `toEqual([])`, which is the shape it had before #136
  // and the only registry→index check in the suite. Everything else runs the
  // other way — `contentIntegrity.ts` and `content/architecture.test.ts` both
  // walk the index and check each id resolves, which cannot see a document that
  // is in `content/` and in no index.
  //
  // What it catches: merging publishes (ADR-0015 §6), and there is no unpublish.
  // A document added to `content/` without an index entry is served at
  // `/d/<id>`, reachable by anyone told the id, invisible in navigation — and
  // without this case, green.
  it('lists every document on the teaching path', () => {
    const listed = walkIndex(courseIndex);
    const unlisted = registry.entries
      .map((e) => e.meta.id)
      .filter((id) => !listed.includes(id))
      .sort();
    expect(
      unlisted,
      'a document is missing from index.yaml — add it to the teaching path. If it is deliberately off the path, bring back the RETIRED allowlist #136 used: name the ids here and assert the set equals them, so the alarm survives the exception.',
    ).toEqual([]);
  });
});
