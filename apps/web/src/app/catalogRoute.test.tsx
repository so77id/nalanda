import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { catalog, families } from '../catalog';

import { AppRoutes } from './AppRoutes';

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('/catalog', () => {
  it('lists every family with its definition', async () => {
    renderAt('/catalog');
    expect(await screen.findByRole('heading', { name: /^catalog$/i })).toBeInTheDocument();
    for (const family of families) {
      expect(screen.getByRole('heading', { name: family.name })).toBeInTheDocument();
      expect(screen.getByText(family.definition)).toBeInTheDocument();
    }
  });

  it('points each family link at its route segment, not its display name', async () => {
    renderAt('/catalog');
    await screen.findByRole('heading', { name: /^catalog$/i });
    for (const family of families) {
      // Guards the accented-name mistake: ids are route segments, names are not.
      expect(screen.getByRole('link', { name: family.name })).toHaveAttribute(
        'href',
        `/catalog/${family.id}`,
      );
    }
    expect(screen.getByRole('link', { name: /governance/i })).toHaveAttribute(
      'href',
      '/catalog/governance',
    );
  });

  it('makes a family name look like the link it is', async () => {
    renderAt('/catalog');
    await screen.findByRole('heading', { name: /^catalog$/i });

    // All four were <a> elements with no colour and no underline: nothing said
    // they were navigable before the pointer was already on them, and a keyboard
    // user got no signal at all.
    for (const family of families) {
      const link = screen.getByRole('link', { name: family.name });
      expect(link.className, `${family.name} does not look like a link`).toMatch(/text-sky-\d00/);
      expect(link.className).toContain('hover:underline');
    }
  });

  it('navigates from the overview into a family page by clicking its link', async () => {
    renderAt('/catalog');
    await screen.findByRole('heading', { name: /^catalog$/i });

    fireEvent.click(screen.getByRole('link', { name: 'Semánticos' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Semánticos' }),
    ).toBeInTheDocument();
  });

  it('shows the empty-family copy for families with no components yet', async () => {
    const empty = families.find((f) => catalog.byFamily(f.id).length === 0);
    expect(
      empty,
      'every family now has components — cover the empty branch with a direct FamilyPage test',
    ).toBeDefined();
    renderAt(`/catalog/${empty!.id}`);
    expect(await screen.findByText(/no components in this family yet/i)).toBeInTheDocument();
  });

  it('shows the 404 page for an unknown family', async () => {
    renderAt('/catalog/nope');
    expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument();
  });
});

describe('/catalog/:family', () => {
  it('lists its components with links to their pages', async () => {
    renderAt('/catalog/estructura');
    await screen.findByRole('heading', { level: 1, name: 'Estructura' });
    const entries = catalog.byFamily('estructura');
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(screen.getByRole('link', { name: entry.name })).toHaveAttribute(
        'href',
        `/catalog/c/${entry.name}`,
      );
    }
  });

  it('navigates into a component page by clicking its link', async () => {
    renderAt('/catalog/estructura');
    await screen.findByRole('heading', { level: 1, name: 'Estructura' });

    fireEvent.click(screen.getByRole('link', { name: 'Slide' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Slide' })).toBeInTheDocument();
  });
});

describe('/catalog/c/:name', () => {
  it('shows the 404 page for an unknown component', async () => {
    renderAt('/catalog/c/nope');
    expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument();
  });

  for (const entry of catalog.entries) {
    it(`documents ${entry.name} with its examples and a back link to its family`, async () => {
      renderAt(`/catalog/c/${entry.name}`);
      await screen.findByRole('heading', { level: 1, name: entry.name });

      expect(screen.getByText(entry.whenToUse)).toBeInTheDocument();
      for (const example of entry.examples) {
        expect(screen.getByRole('heading', { level: 3, name: example.title })).toBeInTheDocument();
      }
      expect(screen.getByRole('link', { name: new RegExp(entry.family) })).toHaveAttribute(
        'href',
        `/catalog/${entry.family}`,
      );
    });
  }

  it('renders the real Slide component in both modes (not just page chrome)', async () => {
    renderAt('/catalog/c/Slide');
    await screen.findByRole('heading', { level: 1, name: 'Slide' });

    // Both examples render the same prose (the selector excludes the code
    // snippets, which quote it); only the book one adds the heading.
    expect(screen.getAllByText(/Comparamos el objetivo/, { selector: 'p' })).toHaveLength(2);
    // Name is a regex: the shell MDX map renders h2s through the anchor factory.
    expect(screen.getByRole('heading', { level: 2, name: /La idea/ })).toBeInTheDocument();
  });

  it('renders the real SectionBreak component (divider in book, nothing in presentation)', async () => {
    renderAt('/catalog/c/SectionBreak');
    const article = await screen.findByRole('main');
    await screen.findByRole('heading', { level: 1, name: 'SectionBreak' });

    expect(within(article).getAllByRole('separator')).toHaveLength(1);
    expect(screen.getAllByText('Antes…')).toHaveLength(2);
  });
});

describe('/catalog/governance', () => {
  it('renders the self-governance rules and links back to the catalog', async () => {
    renderAt('/catalog/governance');
    expect(
      await screen.findByRole('heading', { level: 1, name: /governance/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /component contract/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /review checklist/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /catalog/i })).toHaveAttribute('href', '/catalog');
  });

  it('derives the family folder mapping from the taxonomy', async () => {
    renderAt('/catalog/governance');
    await screen.findByRole('heading', { level: 1, name: /governance/i });
    for (const family of families) {
      expect(
        screen.getByText(new RegExp(`${family.name} → ${family.folder}/`)),
      ).toBeInTheDocument();
    }
  });
});
