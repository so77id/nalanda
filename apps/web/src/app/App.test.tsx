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
    renderAt('/d/hello-mdx');
    expect(await screen.findByRole('heading', { name: 'Hola MDX' })).toBeInTheDocument();
  });

  it('renders wiki-links inside a document as internal links', async () => {
    renderAt('/d/hello-mdx');
    const link = await screen.findByRole('link', { name: 'this same document' });
    expect(link).toHaveAttribute('href', '/d/hello-mdx');
  });

  it('redirects the root route to the first document', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Hola MDX' })).toBeInTheDocument();
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
