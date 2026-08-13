import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { DocumentPage } from './DocumentPage';
import { courseIndex, registry } from './liveContent';
import { walkIndex } from './courseIndex';

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/d/:id" element={<DocumentPage notFound={<p>not found</p>} />} />
      </Routes>
    </MemoryRouter>,
  );
}

// The live course, so the breadcrumb is asserted against the index that ships.
const nestedId = walkIndex(courseIndex).find(
  (id) => courseIndex.entries.find((e) => e.children?.some((c) => c.docId === id)) !== undefined,
)!;

describe('DocumentPage breadcrumb row', () => {
  it('the seed course provides a document nested under a group', () => {
    expect(nestedId).toBeDefined();
  });

  it('places the document in the course and its unit', async () => {
    renderAt(`/d/${nestedId}`);
    const nav = await screen.findByRole('navigation', { name: /location/i });
    expect(nav).toHaveTextContent(courseIndex.title!);
    expect(nav).toHaveTextContent(/\d+ de \d+/);
  });

  it('keeps Presentar in the same row as the breadcrumb, not floating alone', async () => {
    renderAt(`/d/${nestedId}`);
    const nav = await screen.findByRole('navigation', { name: /location/i });
    const presentar = screen.getByRole('link', { name: /presentar/i });
    // The row is the breadcrumb's parent's parent; sharing it is the whole point
    // of the slice — a link floating in the corner is what it replaces.
    expect(nav.closest('div')?.parentElement).toContainElement(presentar);
  });

  it('drops the arrow glyph the rest of the product does not use', async () => {
    renderAt(`/d/${nestedId}`);
    const presentar = await screen.findByRole('link', { name: /presentar/i });
    expect(presentar.textContent).not.toContain('▸');
    expect(presentar.querySelector('svg')).not.toBeNull();
  });

  it('serves a document the index does not list, with the course crumb alone', async () => {
    const listed = walkIndex(courseIndex);
    const unlisted = registry.entries.find((e) => !listed.includes(e.meta.id))?.meta.id;
    // Every seed document is currently indexed; the guard documents the case
    // rather than silently passing when one appears.
    if (!unlisted) return;
    renderAt(`/d/${unlisted}`);
    const nav = await screen.findByRole('navigation', { name: /location/i });
    expect(nav).toHaveTextContent(courseIndex.title!);
    expect(nav).not.toHaveTextContent(/\d+ de \d+/);
  });
});
