import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { walkIndex } from './courseIndex';
import { DocumentPage } from './DocumentPage';
import { courseIndex } from './liveContent';

// A document that counts its own renders. The real one is a compiled MDX module
// behind `lazy`; what this file pins is whether DocumentPage renders it again,
// and a stub answers that without the weight of a course document.
const renders = { count: 0 };
function StubDoc() {
  renders.count += 1;
  return (
    <>
      <h2 id="primera">Primera</h2>
      <p>prosa</p>
      <h2 id="segunda">Segunda</h2>
    </>
  );
}

vi.mock('./lazyDoc', () => ({ lazyDocumentComponent: () => StubDoc }));

// jsdom lays nothing out, so a scroll is stated as where each heading sits —
// the same device useSections.test.tsx uses.
function placeHeadings(tops: Record<string, number>) {
  for (const [id, top] of Object.entries(tops)) {
    const heading = document.getElementById(id);
    if (!heading) throw new Error(`no heading #${id} to place`);
    heading.getBoundingClientRect = () => ({ top, bottom: top + 30 }) as DOMRect;
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renders.count = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DocumentPage', () => {
  // Every heading the reader scrolls past moves the active section, which is
  // state of this page. When that re-rendered the document, a page with 52
  // editors reconfigured all of them at every crossing: about ninety long tasks
  // per scroll on a phone-class CPU over Árboles II (#322). The section mark
  // moves; the document does not render again.
  it('does not render the document again when the reader scrolls past a heading', async () => {
    const id = walkIndex(courseIndex)[0]!;
    await act(async () => {
      render(
        <MemoryRouter initialEntries={[`/d/${id}`]}>
          <Routes>
            <Route path="/d/:id" element={<DocumentPage notFound={null} />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    const before = renders.count;
    expect(before).toBeGreaterThan(0);

    placeHeadings({ primera: 10, segunda: 2000 });
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(20);
    });
    placeHeadings({ primera: -2000, segunda: 10 });
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(20);
    });

    const marked = screen
      .getAllByRole('link', { name: 'Segunda' })
      .filter((link) => link.getAttribute('aria-current') === 'true');
    expect(marked.length).toBeGreaterThan(0);
    expect(renders.count).toBe(before);
  });
});
