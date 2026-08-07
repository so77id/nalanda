import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { courseIndex, registry, walkIndex } from '../content';

import { AppRoutes } from './AppRoutes';

const ids = walkIndex(courseIndex);
const firstId = ids[0]!;
const firstTitle = registry.get(firstId)?.meta.title ?? firstId;

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

async function findCounter() {
  return screen.findByText(/^\d+ \/ \d+$/);
}

describe('PresentationPage viewer', () => {
  it('opens on the cover slide with the document title and a counter', async () => {
    renderAt(`/d/${firstId}/present`);
    expect(await screen.findByRole('heading', { name: firstTitle })).toBeInTheDocument();
    expect(await findCounter()).toHaveTextContent(/^1 \/ \d+$/);
  });

  it('navigates with ArrowRight/ArrowLeft and clamps at the edges', async () => {
    renderAt(`/d/${firstId}/present`);
    const counter = await findCounter();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(counter).toHaveTextContent(/^1 \//);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter).toHaveTextContent(/^2 \//);
  });

  it('advances with Space and jumps with Home/End', async () => {
    renderAt(`/d/${firstId}/present`);
    const counter = await findCounter();
    const total = Number(counter.textContent!.split('/')[1]);

    fireEvent.keyDown(window, { key: 'End' });
    expect(counter).toHaveTextContent(`${total} / ${total}`);

    fireEvent.keyDown(window, { key: 'Home' });
    expect(counter).toHaveTextContent(/^1 \//);

    fireEvent.keyDown(window, { key: ' ' });
    expect(counter).toHaveTextContent(/^2 \//);
  });

  it('deep-links to a slide via ?slide=N and clamps out-of-range values', async () => {
    renderAt(`/d/${firstId}/present?slide=2`);
    expect(await findCounter()).toHaveTextContent(/^2 \//);
  });

  it('returns to the book view on Escape', async () => {
    renderAt(`/d/${firstId}/present`);
    await findCounter();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByRole('article')).toBeInTheDocument();
  });

  it('offers a fullscreen control', async () => {
    renderAt(`/d/${firstId}/present`);
    await findCounter();
    expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument();
  });
});

describe('presentation: none documents', () => {
  it('redirects /present back to the book view', async () => {
    const noneId = ids.find((id) => registry.get(id)?.meta.presentation === 'none');
    expect(noneId, 'seed course needs a presentation:none document').toBeDefined();
    renderAt(`/d/${noneId}/present`);
    expect(await screen.findByRole('article')).toBeInTheDocument();
  });
});

describe('book-view entry points to presentation', () => {
  it('shows a Presentar toggle in the document header', async () => {
    renderAt(`/d/${firstId}`);
    const toggle = await screen.findByRole('link', { name: /presentar/i });
    expect(toggle).toHaveAttribute('href', `/d/${firstId}/present`);
  });

  it('hides the toggle for presentation: none documents', async () => {
    const noneId = ids.find((id) => registry.get(id)?.meta.presentation === 'none')!;
    renderAt(`/d/${noneId}`);
    await screen.findByRole('article');
    expect(screen.queryByRole('link', { name: /presentar/i })).not.toBeInTheDocument();
  });

  it('enters presentation with the p key from the book view', async () => {
    renderAt(`/d/${firstId}`);
    await screen.findByRole('article');
    fireEvent.keyDown(window, { key: 'p' });
    expect(await screen.findByText(/^\d+ \/ \d+$/)).toBeInTheDocument();
  });
});
