import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';

import { courseIndex, registry, walkIndex } from '../content';
import { AppRoutes } from './AppRoutes';

// Assertions derive from the live index/registry (never hardcoded titles) so
// editing course material — an authoring act — cannot break shell tests.
// Seed convention: each document's h1 equals its frontmatter title.
const ids = walkIndex(courseIndex);
const titleOf = (id: string) => registry.get(id)?.meta.title ?? id;

// Every assertion below lives on the far side of `lazy(entry.load)`
// (`content/lazyDoc.ts`), so each one raced the document module against the
// 1000ms window `findBy*` gives an assertion. Resolving the modules once, here,
// takes the machine out of the verdict (#102). Under a simulated 1500ms first
// load — the shape a busy box produces — this file failed without it.
//
// Duplicated in the three app-level files that need it rather than shared: the
// repo already records that a test double needed by two places is duplicated,
// not shared (`docs/standards/testing-strategy.md` §Conventions), and three
// lines are cheaper to read in place than to go and find.
beforeAll(async () => {
  await Promise.all(registry.entries.map((entry) => entry.load()));
});

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('routing', () => {
  it('has a course with enough documents to exercise navigation', () => {
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it('renders a document by id at /d/:id', async () => {
    renderAt(`/d/${ids[0]}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: titleOf(ids[0]!) }),
    ).toBeInTheDocument();
  });

  it('renders in-document wiki-links as internal links that resolve', async () => {
    renderAt(`/d/${ids[0]}`);
    await screen.findByRole('heading', { level: 1 });
    const article = screen.getByRole('article');
    const internal = within(article)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('/d/'));
    expect(internal.length).toBeGreaterThan(0);
    for (const link of internal) {
      expect(registry.get(link.getAttribute('href')!.slice('/d/'.length))).toBeDefined();
    }
  });

  it('redirects the root route to the first index entry (the welcome document)', async () => {
    renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: titleOf(ids[0]!) }),
    ).toBeInTheDocument();
  });

  it('shows prev/next navigation following the index order', async () => {
    renderAt(`/d/${ids[1]}`);
    await screen.findByRole('heading', { level: 1 });
    const sequence = screen.getByRole('navigation', { name: 'Documento anterior y siguiente' });
    expect(sequence).toHaveTextContent(titleOf(ids[0]!));
    expect(sequence).toHaveTextContent(titleOf(ids[2]!));
  });

  it('renders the presentation viewer at /d/:id/present', async () => {
    // A PRESENTABLE document, not simply the first one (#108). Today the two
    // resolve to the same document; this guards the case where they stop doing
    // so, because a `none` document redirects /present back to the book, which
    // reads here as "the viewer did not render". Note the opening document is
    // currently pinned to `auto` as the suite's fixture, not by preference —
    // add-a-course-document.md step 2 (Frontmatter) has the reason.
    const presentableId = ids.find((id) => registry.get(id)?.meta.presentation !== 'none')!;
    renderAt(`/d/${presentableId}/present`);
    expect(
      await screen.findByRole('heading', { name: titleOf(presentableId) }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('shows the 404 page for an unknown id at /present', () => {
    renderAt('/d/does-not-exist/present');
    expect(screen.getByRole('heading', { name: /not found/i })).toBeInTheDocument();
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
