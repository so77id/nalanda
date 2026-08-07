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

describe('/catalog/c/:name', () => {
  it('shows the 404 page for an unknown component', async () => {
    renderAt('/catalog/c/nope');
    expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument();
  });
});

describe('component entries (AC2)', () => {
  for (const name of ['Slide', 'SectionBreak']) {
    it(`renders a complete page for ${name} with live examples`, async () => {
      renderAt(`/catalog/c/${name}`);
      expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument();
      expect(screen.getByText(/when to use/i)).toBeInTheDocument();
      const propsDocumented =
        screen.queryByRole('table') !== null || screen.queryByText(/takes no props/i) !== null;
      expect(propsDocumented).toBe(true);
      const examples = screen.getAllByRole('heading', { level: 3 });
      expect(examples.length).toBeGreaterThanOrEqual(2);
    });
  }

  it('lists both structural components in the estructura family', async () => {
    renderAt('/catalog/estructura');
    expect(await screen.findByRole('link', { name: 'Slide' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SectionBreak' })).toBeInTheDocument();
  });
});
