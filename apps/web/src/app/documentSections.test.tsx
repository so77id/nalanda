import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';

import { courseIndex, registry, walkIndex } from '../content';

import { AppRoutes } from './AppRoutes';

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

// L4-ish: this invariant binds the content feature to the shell and cannot live
// in either alone. The section rail reads `h2` elements from the rendered
// article (ADR-0021), and in an `explicit` document those headings exist only
// because <Slide title> renders the h2 the SHELL's MDX map provides. Mounted
// without that map, every Slide title would be a plain <h2> with no id and the
// rail would silently list nothing.
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

const ids = walkIndex(courseIndex);

// Named, not discovered (#108). Picking "the first auto document" and "the first
// explicit one" reads as robust and is the opposite: it silently follows the
// index. When 02-intro-estructuras declared `explicit` it became the first one,
// and the explicit case moved onto it — a document whose h2s are ALL
// `<Slide title>`, so the equivalence asserted below (both heading sources, one
// section list) stopped being exercised. busqueda-binaria carries both. The
// suite stayed green while the case stopped testing what it is named for.
//
// `presentation` is no longer defaulted in either selector either: since #108
// every document declares it, so `?? 'auto'` could only ever fire for an id the
// registry does not have — selecting a document that does not exist.
const AUTO_FIXTURE = 'bienvenida';
const EXPLICIT_FIXTURE = 'busqueda-binaria';
const autoId = ids.find((id) => id === AUTO_FIXTURE);
const explicitId = ids.find((id) => id === EXPLICIT_FIXTURE);

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
  it('the seed course still provides the two fixtures these cases describe', () => {
    expect(
      autoId,
      `${AUTO_FIXTURE} left the index. It is the seed course's only \`presentation: auto\` document (see add-a-course-document.md step 2 (Frontmatter)) — declare another document auto and name it here, or these cases stop covering the markdown-h2 rail path.`,
    ).toBeDefined();
    expect(
      registry.get(autoId!)?.meta.presentation,
      `${AUTO_FIXTURE} no longer declares auto`,
    ).toBe('auto');
    expect(
      explicitId,
      `${EXPLICIT_FIXTURE} left the index. Repoint this block at another document carrying BOTH heading sources — a markdown "##" and <Slide title> h2s — not merely at any explicit document, or the equivalence below stops being tested.`,
    ).toBeDefined();
    expect(
      registry.get(explicitId!)?.meta.presentation,
      `${EXPLICIT_FIXTURE} no longer declares explicit`,
    ).toBe('explicit');
  });

  it('lists every section of an auto document, in order', async () => {
    await renderAt(`/d/${autoId}`);

    // The canary: `getAllBy` cannot wait, and an `h2` exists only once the lazy
    // document has rendered — `article` does not, it is the shell's and is on
    // this side of the boundary. If the preload above is removed this fails on
    // every machine instead of reddening in CI at random (#102, step 3).
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    const headings = await headingIdsOf();
    expect(headings.length).toBeGreaterThan(0);
    expect(await railLinkTargets()).toEqual(headings.map((id) => `#${id}`));
  });

  it('lists the same spine for an explicit document, whose sections are <Slide> markers', async () => {
    // The equivalence AC4 asks for: two different slide-cutting rules, one
    // section list, because both render the same MDX-mapped h2 in book mode.
    await renderAt(`/d/${explicitId}`);
    const headings = await headingIdsOf();
    expect(headings.length).toBeGreaterThan(0);
    expect(await railLinkTargets()).toEqual(headings.map((id) => `#${id}`));
  });

  it('names the sections with the slide titles the reader sees', async () => {
    await renderAt(`/d/${explicitId}`);
    const article = await screen.findByRole('article');
    await waitFor(() => expect(article.querySelector('h2[id]')).not.toBeNull());
    const firstHeading = article.querySelector('h2[id]')!;
    const rail = await screen.findByRole('navigation', { name: /en esta página/i });
    // Not the raw textContent: the heading carries a "#" self-anchor sibling.
    // Read it out of the DOM rather than out of the anchor's accessible name,
    // which is prose and has been reworded once already.
    const heading = firstHeading.cloneNode(true) as HTMLElement;
    heading.querySelector('a[href^="#"]')?.remove();
    expect(within(rail).getAllByRole('link')[0]?.textContent).toBe(heading.textContent?.trim());
  });

  it('shows no rail for a document with no sections at all', async () => {
    const flatId = ids.find((id) => registry.get(id)?.meta.presentation === 'none');
    expect(flatId, 'seed course needs a document without sections').toBeDefined();
    await renderAt(`/d/${flatId}`);
    const article = await screen.findByRole('article');
    // Wait for the document itself, not just the element that will hold it.
    // Asserting straight after findByRole passed for a document that HAS
    // sections: the article exists long before its lazy chunk arrives, so the
    // rail was absent because nothing had rendered yet.
    await waitFor(() => expect(article.textContent?.trim()).not.toBe(''));
    expect(screen.queryByRole('navigation', { name: /en esta página/i })).not.toBeInTheDocument();
  });
});
