import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { courseIndex, walkIndex } from '../content';

import { AppRoutes } from './AppRoutes';

// The drawer's own contract (focus trap, Escape, focus return) is unit-tested in
// content/Drawer.test.tsx. What only the shell can exercise is the flow: real
// documents, real routing, and the map that lets a second document render at
// all when the reader picks it from inside the drawer.
function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

const ids = walkIndex(courseIndex);
const firstId = ids[0]!;

async function openDrawer() {
  const user = userEvent.setup();
  renderAt(`/d/${firstId}`);
  await screen.findByRole('article');
  await user.click(screen.getByRole('button', { name: /abrir el índice/i }));
  return user;
}

describe('the course index drawer', () => {
  it('is not on the page by default — the reading column gets the width', async () => {
    renderAt(`/d/${firstId}`);
    await screen.findByRole('article');
    // The desktop sidebar still renders and CSS hides it; what must not exist
    // is a second, already-open copy over the document.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens from a labelled button and carries the whole index', async () => {
    await openDrawer();
    const drawer = screen.getByRole('dialog', { name: /índice del curso/i });
    expect(within(drawer).getByRole('navigation', { name: /course index/i })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /abrir el índice/i })).toHaveFocus();
  });
});
