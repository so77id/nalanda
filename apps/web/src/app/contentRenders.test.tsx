import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';

import { registry } from '../content';

import { AppRoutes } from './AppRoutes';

/**
 * L4 — every published document renders without an authoring error.
 *
 * The hole this closes, found reviewing #120 after it had already shipped: the
 * component contracts a document can break at RUNTIME — `<Figure>` without an
 * alt or with an unresolved src, `<Split>` given other than two blocks,
 * `<Mosaic>` without `columns` or `description` — do not throw. They render an
 * `AuthoringError`, deliberately (ADR-0029, and the same reasoning as a broken
 * wiki-link): a red box on the page beats a dead build while someone is drafting.
 *
 * But merging publishes the site. `contentIntegrity` validates frontmatter and
 * the index; `content/architecture.test.ts` checks that every referenced image
 * FILE exists. Neither evaluates MDX, so nothing saw the difference between a
 * document and a document with a red box on it — and #120 put three `<Split>`s,
 * three `<Mosaic>`s and 27 images on the page served at `/`. During that WP a
 * `<Split>` given four blocks did paint one, and it was caught by looking at the
 * page rather than by any gate.
 *
 * This is the cheapest thing that would have caught it: render what the reader
 * gets, for every document the registry publishes.
 *
 * Page-level, and therefore here rather than in `content/`: a document body may
 * use any shell-registered component, and those resolve only through the
 * shell's MDX map (`app/mdxComponents.ts`). Mounted with a feature-local map
 * every marker would be an unknown tag and this case would pass vacuously.
 */
beforeAll(async () => {
  await Promise.all(registry.entries.map((entry) => entry.load()));
});

async function renderAt(path: string): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

describe('architecture: every published document renders clean', () => {
  it('finds documents to check', () => {
    expect(
      registry.entries.length,
      'the registry is empty — this file would pass vacuously',
    ).toBeGreaterThan(0);
  });

  it.each(registry.entries.map((e) => e.meta.id))('%s carries no authoring error', async (id) => {
    await renderAt(`/d/${id}`);
    const article = await screen.findByRole('article');

    // The article element is the shell's and exists before its lazy document
    // does (#102), so an empty one would make the assertion below meaningless.
    expect(article.textContent?.trim(), `${id} rendered an empty article`).not.toBe('');

    const errors = [...article.querySelectorAll('[data-authoring-error]')].map(
      (el) => `<${el.getAttribute('data-authoring-error')}> ${el.textContent?.trim()}`,
    );
    expect(errors, `${id} paints an authoring error a reader would see`).toEqual([]);
  });
});
