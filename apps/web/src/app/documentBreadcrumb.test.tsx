import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { courseIndex, walkIndex } from '../content';

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

  // The unlisted-document cases lived here from #136 until #135. They needed a
  // document that is compiled but off the teaching path, and the `RETIRED`
  // allowlist named the set so a document forgotten out of `index.yaml` still
  // reddened the suite.
  //
  // #135 emptied that set: the three Fundamentos documents are gone and
  // `planificacion` joined the path. Keeping the cases alive would mean leaving
  // some document off the index to serve them, which is inventing content for a
  // test — the shape ADR-0025 exists to prevent, and the escape hatch the guard
  // message itself offered.
  //
  // What they asserted is still covered where it needs no fixture:
  // `content/courseIndex.test.ts` (trailFor, two cases) and
  // `content/Breadcrumb.test.tsx` ("shows the course alone for a document the
  // index does not list").
  //
  // If a document is ever deliberately unlisted again, this is where the
  // allowlist and both cases come back.
});
