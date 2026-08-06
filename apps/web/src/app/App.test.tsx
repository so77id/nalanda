import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { courseIndex, registry, walkIndex } from '../content';
import { AppRoutes } from './AppRoutes';

// Assertions derive from the live index/registry (never hardcoded titles) so
// editing course material — an authoring act — cannot break shell tests.
// Seed convention: each document's h1 equals its frontmatter title.
const ids = walkIndex(courseIndex);
const titleOf = (id: string) => registry.get(id)?.meta.title ?? id;

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
    const sequence = screen.getByRole('navigation', { name: 'Document sequence' });
    expect(sequence).toHaveTextContent(titleOf(ids[0]!));
    expect(sequence).toHaveTextContent(titleOf(ids[2]!));
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
