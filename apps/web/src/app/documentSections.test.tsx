import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { courseIndex, registry, walkIndex } from '../content';

import { AppRoutes } from './AppRoutes';

// L4-ish: this invariant binds the content feature to the shell and cannot live
// in either alone. The section rail reads `h2` elements from the rendered
// article (ADR-0021), and in an `explicit` document those headings exist only
// because <Slide title> renders the h2 the SHELL's MDX map provides. Mounted
// without that map, every Slide title would be a plain <h2> with no id and the
// rail would silently list nothing.
function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

const ids = walkIndex(courseIndex);
const autoId = ids.find((id) => (registry.get(id)?.meta.presentation ?? 'auto') === 'auto')!;
const explicitId = ids.find((id) => registry.get(id)?.meta.presentation === 'explicit')!;

/**
 * The h2 ids the article actually painted — the answer key for the rail. The
 * article element exists before its document does (Suspense), so this waits for
 * the content rather than reading an empty shell.
 */
async function headingIdsOf(): Promise<string[]> {
  const article = await screen.findByRole('article');
  await waitFor(() => expect(article.querySelectorAll('h2[id]').length).toBeGreaterThan(0));
  return [...article.querySelectorAll('h2[id]')].map((h) => h.id);
}

async function railLinkTargets(): Promise<string[]> {
  const rail = await screen.findByRole('navigation', { name: /en esta página/i });
  return [...within(rail).getAllByRole('link')].map((a) => a.getAttribute('href') ?? '');
}

describe('the section rail over real documents', () => {
  it('the seed course provides both an auto and an explicit document', () => {
    expect(autoId, 'no presentation: auto document').toBeDefined();
    expect(explicitId, 'no presentation: explicit document').toBeDefined();
  });

  it('lists every section of an auto document, in order', async () => {
    renderAt(`/d/${autoId}`);
    const headings = await headingIdsOf();
    expect(headings.length).toBeGreaterThan(0);
    expect(await railLinkTargets()).toEqual(headings.map((id) => `#${id}`));
  });

  it('lists the same spine for an explicit document, whose sections are <Slide> markers', async () => {
    // The equivalence AC4 asks for: two different slide-cutting rules, one
    // section list, because both render the same MDX-mapped h2 in book mode.
    renderAt(`/d/${explicitId}`);
    const headings = await headingIdsOf();
    expect(headings.length).toBeGreaterThan(0);
    expect(await railLinkTargets()).toEqual(headings.map((id) => `#${id}`));
  });

  it('names the sections with the slide titles the reader sees', async () => {
    renderAt(`/d/${explicitId}`);
    const article = await screen.findByRole('article');
    await waitFor(() => expect(article.querySelector('h2[id]')).not.toBeNull());
    const firstHeading = article.querySelector('h2[id]')!;
    const rail = await screen.findByRole('navigation', { name: /en esta página/i });
    // Not the raw textContent: the heading carries a "#" self-anchor sibling.
    expect(within(rail).getAllByRole('link')[0]?.textContent).toBe(
      firstHeading
        .querySelector('a[href^="#"]')
        ?.getAttribute('aria-label')
        ?.match(/"(.*)"/)?.[1],
    );
  });

  it('shows no rail for a document with no sections at all', async () => {
    const flatId = ids.find((id) => registry.get(id)?.meta.presentation === 'none');
    expect(flatId, 'seed course needs a document without sections').toBeDefined();
    renderAt(`/d/${flatId}`);
    const article = await screen.findByRole('article');
    // Wait for the document itself, not just the element that will hold it.
    // Asserting straight after findByRole passed for a document that HAS
    // sections: the article exists long before its lazy chunk arrives, so the
    // rail was absent because nothing had rendered yet.
    await waitFor(() => expect(article.textContent?.trim()).not.toBe(''));
    expect(screen.queryByRole('navigation', { name: /en esta página/i })).not.toBeInTheDocument();
  });
});
