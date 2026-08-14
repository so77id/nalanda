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

  // The unlisted-document case used to be untestable here. It was written with
  // an `if (!unlisted) return;` guard, and since every seed document was indexed
  // the body never ran — a test that read as coverage and could not fail. It was
  // replaced by an assertion that the premise held: every document is listed.
  //
  // That premise is now false ON PURPOSE. Retiring the Fundamentos unit from the
  // teaching path left three documents compiled and served but off the index,
  // which is exactly the shape the guard could never reach — so the case it was
  // standing in for is finally exercisable against real content, and the
  // stand-in is gone.
  it('shows the course alone for a document the index does not list', async () => {
    const listed = walkIndex(courseIndex);
    const unlisted = registry.entries.find((e) => !listed.includes(e.meta.id));
    expect(
      unlisted,
      'every document is on the teaching path again — this case needs one that is not, or the unlisted breadcrumb is unexercised here (its unit cover is courseIndex.test.ts trailFor + Breadcrumb.test.tsx)',
    ).toBeDefined();

    renderAt(`/d/${unlisted!.meta.id}`);
    const nav = await screen.findByRole('navigation', { name: /ubicaci/i });
    // The course still names where the reader is; what an unlisted document has
    // no claim to is a position in the path.
    expect(nav).toHaveTextContent(courseIndex.title!);
    expect(nav).not.toHaveTextContent(/\d+ de \d+/);
  });
});
