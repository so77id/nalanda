import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';

import { courseIndex, registry, walkIndex } from '../content';
import { AppRoutes } from './AppRoutes';

// Assertions derive from the live index/registry (never hardcoded titles) so
// editing course material — an authoring act — cannot break shell tests.
// Seed convention: each document's h1 equals its frontmatter title.
const ids = walkIndex(courseIndex);
const titleOf = (id: string) => registry.get(id)?.meta.title ?? id;

// Every assertion that reaches document content lives on the far side of `lazy(entry.load)`
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

/**
 * Renders at `path` with the first commit flushed.
 *
 * `React.lazy` suspends even when the module is already cached, so without the
 * flush the assertion runs against the Suspense fallback. Step 2 of the
 * lazy-boundary recipe in `docs/standards/testing-strategy.md` §Conventions
 * (#102).
 */
async function renderAt(path: string): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

describe('routing', () => {
  it('has a course with enough documents to exercise navigation', () => {
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it('renders a document by id at /d/:id', async () => {
    await renderAt(`/d/${ids[0]}`);

    // The canary (step 3 of the lazy-boundary recipe): `getBy`, which cannot
    // wait. If the preload above is ever removed this fails on every machine,
    // instead of reddening in CI at random — which is what #102 was.
    expect(screen.getByRole('heading', { level: 1, name: titleOf(ids[0]!) })).toBeInTheDocument();
  });

  it('renders in-document wiki-links as internal links that resolve', async () => {
    await renderAt(`/d/${ids[0]}`);
    await screen.findByRole('heading', { level: 1 });
    const article = screen.getByRole('article');
    // Wiki-links point at `/d/<id>` — a bare document id, nothing after it.
    // The `/present?section=` links added by #256's per-heading button also
    // sit under `/d/`, so a `.startsWith('/d/')` filter now catches them and
    // asks the registry for `<id>/present?section=<slug>`, which is not an
    // id and never resolves. Exclude anything with a path segment after `/d/<id>`.
    const internal = within(article)
      .getAllByRole('link')
      .filter((a) => {
        const href = a.getAttribute('href') ?? '';
        return href.startsWith('/d/') && href.indexOf('/', '/d/'.length) === -1;
      });
    expect(internal.length).toBeGreaterThan(0);
    for (const link of internal) {
      expect(registry.get(link.getAttribute('href')!.slice('/d/'.length))).toBeDefined();
    }
  });

  it('redirects the root route to the first index entry (the welcome document)', async () => {
    await renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: titleOf(ids[0]!) }),
    ).toBeInTheDocument();
  });

  it('shows prev/next navigation following the index order', async () => {
    await renderAt(`/d/${ids[1]}`);
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
    await renderAt(`/d/${presentableId}/present`);
    expect(
      await screen.findByRole('heading', { name: titleOf(presentableId) }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('shows the 404 page for an unknown id at /present', async () => {
    await renderAt('/d/does-not-exist/present');
    expect(screen.getByRole('heading', { name: /not found/i })).toBeInTheDocument();
  });

  it('shows the 404 page for an unknown document id', async () => {
    await renderAt('/d/does-not-exist');
    expect(screen.getByRole('heading', { name: /not found/i })).toBeInTheDocument();
  });

  it('shows the 404 page for an unknown route', async () => {
    await renderAt('/nope');
    expect(screen.getByRole('heading', { name: /not found/i })).toBeInTheDocument();
  });

  // #135 deleted four PUBLISHED documents — merging deploys, so `/d/<id>` had
  // been answering for `intro-estructuras`, `busqueda-binaria`,
  // `codigo-ejecutable` and `apuntes-del-curso`. They 404 now, and no redirect
  // ships: the material was retired rather than moved, so there is nowhere
  // honest to send a reader.
  //
  // That break is deliberately NOT pinned by id, and the reason is worth
  // recording because `testing-strategy.md` §Conventions says to pin one. That
  // rule protects whoever still holds the old URL — it stops a stale link from
  // silently resolving to a DIFFERENT document later. Here nobody holds them
  // (#135: they were demo pages), so there is no one to protect, and the cost
  // lands on the wrong day: three of those four ids are core topics of this
  // course — binary search, an introduction to structures, executable code —
  // and v0.2 exists to write them properly. A pin would fire the day the
  // material comes BACK, which is the good day, and its only remedy would be
  // deleting the case. The generic unknown-id cases above already prove the 404
  // path; what actually matters — that no document ships outside the index —
  // is asserted in `documentBreadcrumb.test.tsx`.
});
