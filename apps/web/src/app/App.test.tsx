import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppRoutes } from './App';

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('routing', () => {
  it('renders a document by id at /d/:id', async () => {
    renderAt('/d/bienvenida');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bienvenida' }),
    ).toBeInTheDocument();
  });

  it('renders wiki-links inside a document as internal links', async () => {
    renderAt('/d/bienvenida');
    const link = await screen.findByRole('link', { name: 'una búsqueda clásica' });
    expect(link).toHaveAttribute('href', '/d/busqueda-binaria');
  });

  it('redirects the root route to the first index entry (the welcome document)', async () => {
    renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bienvenida' }),
    ).toBeInTheDocument();
  });

  it('shows prev/next navigation following the index order', async () => {
    renderAt('/d/intro-estructuras');
    await screen.findByRole('heading', { level: 1, name: '¿Qué es una estructura de datos?' });
    const sequence = screen.getByRole('navigation', { name: 'Document sequence' });
    expect(sequence).toHaveTextContent('Bienvenida');
    expect(sequence).toHaveTextContent('Búsqueda binaria');
  });

  it('shows the 404 page for an unknown document id', () => {
    renderAt('/d/does-not-exist');
    expect(screen.getByRole('heading', { name: /not found/i })).toBeInTheDocument();
  });

  it('shows the 404 page for an unknown route', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: /not found/i })).toBeInTheDocument();
  });
});
