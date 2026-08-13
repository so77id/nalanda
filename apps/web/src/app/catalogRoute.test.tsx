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

    fireEvent.click(screen.getByRole('link', { name: 'Semantic' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Semantic' })).toBeInTheDocument();
  });

  // Both of these assert INSIDE each family's <li>. Page-wide counting looked
  // equivalent and was not: with two empty families and two populated ones, the
  // totals stay identical when the two halves are swapped, so the page-wide
  // form stayed green while showing every fact on the wrong family (#87 S8).
  function familyItem(name: string): HTMLElement {
    const item = screen.getByRole('heading', { name }).closest('li');
    expect(item, `no <li> around the ${name} heading`).not.toBeNull();
    return item as HTMLElement;
  }

  it('counts each family in words that agree with its own number', async () => {
    renderAt('/catalog');
    await screen.findByRole('heading', { name: /^catalog$/i });
    for (const family of families) {
      const n = catalog.byFamily(family.id).length;
      const expected = n === 0 ? 'no components' : `${n} component${n === 1 ? '' : 's'}`;
      expect(
        within(familyItem(family.name)).getByText(expected),
        `${family.name} should show "${expected}"`,
      ).toBeInTheDocument();
    }
    expect(screen.queryByText(/component\(s\)/)).not.toBeInTheDocument();
  });

  it('says on the overview that an empty family is empty by design, and only there', async () => {
    // The overview is where the two holes sit beside the populated families and
    // where, until #87, they were indistinguishable from them.
    renderAt('/catalog');
    await screen.findByRole('heading', { name: /^catalog$/i });

    const emptyCount = families.filter((f) => catalog.byFamily(f.id).length === 0).length;
    expect(emptyCount, 'no empty family left to describe').toBeGreaterThan(0);

    for (const family of families) {
      const isEmpty = catalog.byFamily(family.id).length === 0;
      const note = within(familyItem(family.name)).queryByText(/built when a class needs one/i);
      expect(
        note !== null,
        `${family.name} ${isEmpty ? 'should' : 'should not'} carry the empty-by-design note`,
      ).toBe(isEmpty);
    }
  });

  it('explains an empty family on its own page, without citing a decision id as the reason', async () => {
    const empty = families.find((f) => catalog.byFamily(f.id).length === 0);
    expect(
      empty,
      'every family now has components — cover the empty branch with a direct FamilyPage test',
    ).toBeDefined();
    renderAt(`/catalog/${empty!.id}`);

    const copy = await screen.findByText(/nothing lives here yet/i);
    expect(copy).toHaveTextContent(/built when a class needs one/i);
    // The old copy was "the inventory is emergent (D29)": a pointer to a
    // decision the reader has not read, standing in for the explanation.
    expect(copy).not.toHaveTextContent(/inventory is emergent/i);
  });

  it('does not site an empty family in a folder that is not there', async () => {
    // src/components/semantic/ and media/ do not exist: the first component
    // added to a family creates it. "Components live in ..." was a claim the
    // repo contradicted.
    expect(
      catalog.byFamily('media').length,
      'media has components now — point this test at a family that is still empty, ' +
        'and add /catalog/media to the rendered-English path list below',
    ).toBe(0);

    renderAt('/catalog/media');
    await screen.findByRole('heading', { level: 1, name: 'Media' });
    // The path sits in its own <code>; the tense is on the paragraph around it.
    expect(screen.getByText(/src\/components\/media\//).parentElement).toHaveTextContent(
      /components will live in/i,
    );
  });

  it('sites a populated family in the folder its components already occupy', async () => {
    // The other half of the tense branch. Pinning only the empty side let a
    // constant 'will live' pass the whole suite, so /catalog/structure could
    // deny the existence of the folder holding the three components listed
    // right below it.
    renderAt('/catalog/structure');
    await screen.findByRole('heading', { level: 1, name: 'Structure' });
    const line = screen.getByText(/src\/components\/structure\//).parentElement;
    expect(line).toHaveTextContent(/components live in/i);
    expect(line).not.toHaveTextContent(/will live/i);
  });

  it('leaves a populated family free of empty-state copy', async () => {
    renderAt('/catalog/structure');
    await screen.findByRole('heading', { level: 1, name: 'Structure' });
    expect(screen.queryByText(/nothing lives here yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/built when a class needs one/i)).not.toBeInTheDocument();
  });

  it('shows the 404 page for an unknown family', async () => {
    renderAt('/catalog/nope');
    expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument();
  });
});

describe('/catalog/:family', () => {
  it('lists its components with links to their pages', async () => {
    renderAt('/catalog/structure');
    await screen.findByRole('heading', { level: 1, name: 'Structure' });
    const entries = catalog.byFamily('structure');
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(screen.getByRole('link', { name: entry.name })).toHaveAttribute(
        'href',
        `/catalog/c/${entry.name}`,
      );
    }
  });

  it('navigates into a component page by clicking its link', async () => {
    renderAt('/catalog/structure');
    await screen.findByRole('heading', { level: 1, name: 'Structure' });

    fireEvent.click(screen.getByRole('link', { name: 'Slide' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Slide' })).toBeInTheDocument();
  });

  // The rename breaks these URLs and no redirect is shipped for them (#87): a
  // v0.1 documentation surface only this repo links to. Pinned so the break is
  // a decision the suite states, not something a reader discovers.
  it.each(['estructura', 'semanticos', 'interactivos'])(
    'no longer answers the old Spanish segment /catalog/%s',
    async (old) => {
      renderAt(`/catalog/${old}`);
      expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument();
    },
  );
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
      // The glob invariant proves this path exists on disk; this proves the
      // page publishes THAT path. Without it the page could print any string
      // and both tests would stay green.
      expect(
        screen.getByText(`src/components/${entry.family}/${entry.name}.tsx`),
      ).toBeInTheDocument();
      for (const example of entry.examples) {
        expect(screen.getByRole('heading', { level: 3, name: example.title })).toBeInTheDocument();
      }
      // The back link names the family the way every other surface does. It
      // used to render the raw id, which read "estructura" beside a page
      // headed "Estructura" and now would read "structure" beside "Structure".
      // Regex, not an exact name: the link's accessible name carries the "←".
      const familyName = families.find((f) => f.id === entry.family)!.name;
      expect(screen.getByRole('link', { name: new RegExp(`← ${familyName}$`) })).toHaveAttribute(
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

describe('the catalog writes English', () => {
  // Counterpart to the registry-data guard in catalog/architecture.test.tsx.
  // That one reads strings; this one reads what a visitor is shown, which is
  // where the words the PAGES write live — the empty-family note, the folder
  // line, the overview copy, the governance steps.
  const SPANISH_ORTHOGRAPHY = /[áéíóúüñ¿¡]/;

  // /catalog/c/:name is deliberately absent: a component page renders the real
  // Exercise and CodeEditor, whose chrome addresses students in Spanish, and
  // the snippets are course content. Root CLAUDE.md §Language exempts exactly
  // that, so scanning it would flag the one Spanish the WP decided to keep.
  it.each(['/catalog', '/catalog/structure', '/catalog/media', '/catalog/governance'])(
    'renders no Spanish orthography at %s',
    async (path) => {
      renderAt(path);
      const main = await screen.findByRole('main');
      const offenders = (main.textContent ?? '')
        .split('\n')
        .filter((line) => SPANISH_ORTHOGRAPHY.test(line));
      expect(offenders, `Spanish rendered at ${path}`).toEqual([]);
    },
  );
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

  it('names the families an author can choose from', async () => {
    // It used to assert a "Name → folder/" mapping, which the rename turned
    // into the identity `Structure → structure/`. What an author still needs is
    // the list of families; the folder is the id and the page now says so.
    renderAt('/catalog/governance');
    await screen.findByRole('heading', { level: 1, name: /governance/i });
    const step = screen.getByText(/Pick the family/i);
    for (const family of families) {
      expect(step, `governance should name ${family.name}`).toHaveTextContent(family.name);
    }
  });
});
