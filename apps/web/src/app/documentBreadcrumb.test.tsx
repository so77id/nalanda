import { render, screen, within } from '@testing-library/react';
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

  // An unlisted document is served but has no position in the path (ADR-0015 §6,
  // over the content model of ADR-0002).
  // Two cases share this list, and it is spelled out rather than discovered
  // because it is also the invariant below: the set of unlisted documents is
  // closed, and a document that joins it by accident is a mistake nothing else
  // catches.
  const RETIRED = [
    'intro-estructuras',
    'busqueda-binaria',
    'codigo-ejecutable',
    'planificacion',
  ];

  // The registry→index direction, which nothing else in the suite covers:
  // `contentIntegrity.ts` and `content/architecture.test.ts` both walk the index
  // and check each id resolves, never the reverse. An earlier version of this
  // case asserted the set was EMPTY, which is what the authoring guide described
  // until it was rewritten alongside this change (add-a-course-document.md,
  // step 8 — Register it in the teaching path); retiring the Fundamentos unit
  // made "empty" false, and
  // deleting the assertion outright would have left a document forgotten out of
  // index.yaml shipping green and unreachable in navigation. Naming the set
  // keeps the alarm and states which absences are deliberate.
  it('lists every document except the ones deliberately retired', () => {
    const listed = walkIndex(courseIndex);
    const unlisted = registry.entries
      .map((e) => e.meta.id)
      .filter((id) => !listed.includes(id))
      .sort();
    expect(
      unlisted,
      'the unlisted set does not match RETIRED. A document missing from index.yaml: add it to the teaching path, or to RETIRED above if it is off the path on purpose. A document RETIRED still names but the index now lists: delete it from RETIRED, and repoint the case below, which drives RETIRED[0]. If #135 removed the retired documents: empty this list and retire that case.',
    ).toEqual([...RETIRED].sort());
  });

  it('shows the course alone for a document the index does not list', async () => {
    const unlisted = registry.get(RETIRED[0]!);
    expect(
      unlisted,
      `${RETIRED[0]} left content/ — point this at another unlisted document, or retire this case: its contract is also covered by courseIndex.test.ts (trailFor) and Breadcrumb.test.tsx.`,
    ).toBeDefined();

    renderAt(`/d/${unlisted!.meta.id}`);
    const nav = await screen.findByRole('navigation', { name: /ubicaci/i });
    // The course still names where the reader is; what an unlisted document has
    // no claim to is a position in the path — nor any ancestor above it, which
    // is the half "alone" claims and an earlier version of this case did not
    // assert: a leaked phantom ancestor kept it green.
    expect(nav).toHaveTextContent(courseIndex.title!);
    expect(nav).not.toHaveTextContent(/\d+ de \d+/);
    expect(within(nav).getAllByRole('listitem')).toHaveLength(1);
  });
});
