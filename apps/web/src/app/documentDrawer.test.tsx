import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';

import { courseIndex, registry, walkIndex } from '../content';

import { AppRoutes } from './AppRoutes';

// The drawer's own contract (focus trap, Escape, focus return) is unit-tested in
// content/Drawer.test.tsx. What only the shell can exercise is the flow: real
// documents, real routing, and the map that lets a second document render at
// all when the reader picks it from inside the drawer.
/**
 * Renders at `path` with the first commit flushed.
 *
 * `React.lazy` suspends even when the module is already cached, so without the
 * flush the assertion runs against the Suspense fallback. Step 2 of the
 * lazy-boundary recipe in `docs/standards/testing-strategy.md` §Conventions
 * (#102).
 */
async function renderAt(path: string): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

const ids = walkIndex(courseIndex);

// Every assertion that reaches document content lives on the far side of
// `lazy(entry.load)` (`content/lazyDoc.ts`) — including the `h2[id]` wait in
// `openDrawer`, which this file's own comment already explains. Resolving the
// modules once takes the machine out of the verdict (#102). Review measured
// this file failing the documented slow-load probe; it was the only one left.
beforeAll(async () => {
  await Promise.all(registry.entries.map((entry) => entry.load()));
});

const firstId = ids[0]!;

async function openDrawer() {
  const user = userEvent.setup();
  await renderAt(`/d/${firstId}`);
  const article = await screen.findByRole('article');
  // The article element exists before its lazy document does; without this the
  // drawer can open over an empty spine and the section assertions race.
  await waitFor(() => expect(article.querySelectorAll('h2[id]').length).toBeGreaterThan(0));
  await user.click(screen.getByRole('button', { name: /abrir la navegación/i }));
  return user;
}

describe('the course index drawer', () => {
  it('is not on the page by default — the reading column gets the width', async () => {
    await renderAt(`/d/${firstId}`);

    // The canary: `getAllBy` cannot wait, and an `h2` exists only once the lazy
    // document has rendered — `article` does not, it is the shell's and is on
    // this side of the boundary. If the preload above is removed this fails on
    // every machine instead of reddening in CI at random (#102, step 3).
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    // The desktop sidebar still renders and CSS hides it; what must not exist
    // is a second, already-open copy over the document.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens from a labelled button and carries the whole index', async () => {
    await openDrawer();
    const drawer = screen.getByRole('dialog', { name: /navegación/i });
    expect(
      within(drawer).getByRole('navigation', { name: /índice del curso/i }),
    ).toBeInTheDocument();
  });

  it('closes when a document is opened from inside it', async () => {
    const user = await openDrawer();
    const drawer = screen.getByRole('dialog');
    const other = within(drawer)
      .getAllByRole('link')
      .find((link) => link.getAttribute('href') !== `/d/${firstId}`)!;

    await user.click(other);

    // Left open, it would cover the document the reader just chose. Awaited
    // rather than asserted outright: the destination document is a lazy chunk,
    // so the route commits — and the drawer closes — a tick after the click.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('article')).toBeInTheDocument();
  });

  it('gives focus back to the toggle after closing', async () => {
    const user = await openDrawer();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /abrir la navegación/i })).toHaveFocus();
  });
});

describe('the sections inside the drawer', () => {
  // Below 2xl there is no rail, and below md there is no sidebar either: if the
  // drawer did not carry the sections, those widths would have no way to
  // navigate inside a document at all (AC8).
  function targetsOf(nav: HTMLElement): string[] {
    return within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '');
  }

  it('lists exactly what the rail lists — one spine, two placements', async () => {
    await openDrawer();
    const lists = screen.getAllByRole('navigation', { name: /en esta página/i });

    // Two placements and no more: the rail (hidden by CSS at this width, still
    // in the DOM) and the drawer's copy.
    expect(lists).toHaveLength(2);
    expect(targetsOf(lists[0]!).length, 'the section list is empty').toBeGreaterThan(0);
    expect(targetsOf(lists[0]!)).toEqual(targetsOf(lists[1]!));
  });

  it('filters the index from inside the drawer, focus trap and all', async () => {
    const user = await openDrawer();
    const drawer = screen.getByRole('dialog');
    const field = within(drawer).getByRole('searchbox', { name: /filtrar/i });

    await user.type(field, 'zzzz');

    // Typing has to reach the field even though the drawer traps the keyboard,
    // and the answer has to be an answer rather than an empty panel.
    expect(field).toHaveValue('zzzz');
    expect(within(drawer).getByRole('status')).toHaveTextContent(/nada coincide/i);
  });

  it('closes when a section is chosen, so the reader sees where they landed', async () => {
    const user = await openDrawer();
    const drawer = screen.getByRole('dialog');
    const section = within(
      within(drawer).getByRole('navigation', { name: /en esta página/i }),
    ).getAllByRole('link')[0]!;

    await user.click(section);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
