import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppRoutes } from './AppRoutes';

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('/catalog', () => {
  it('lists the four families with their definitions', async () => {
    renderAt('/catalog');
    expect(await screen.findByRole('heading', { name: /catalog/i })).toBeInTheDocument();
    for (const family of ['Estructura', 'Semánticos', 'Interactivos', 'Media']) {
      expect(screen.getByRole('heading', { name: family })).toBeInTheDocument();
    }
  });

  it('navigates into a family page', async () => {
    renderAt('/catalog/estructura');
    expect(await screen.findByRole('heading', { name: 'Estructura' })).toBeInTheDocument();
  });
});
