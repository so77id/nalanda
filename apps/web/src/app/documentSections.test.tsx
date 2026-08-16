import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';

import { registry } from '../content';

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

// Named, not discovered (#108). Picking "the first auto document" and "the first
// explicit one" reads as robust and is the opposite: it silently follows the
// index. When 02-intro-estructuras declared `explicit` it became the first one,
// and the explicit case moved onto it — a document whose h2s are ALL
// `<Slide title>`, so the equivalence asserted below (both heading sources, one
// section list) stopped being exercised. `java-tipos-y-flujo`, the fixture since
// #135, carries both. The suite stayed green while the case stopped testing what
// it is named for.
//
// `presentation` is no longer defaulted in either selector either: since #108
// every document declares it, so `?? 'auto'` could only ever fire for an id the
// registry does not have — selecting a document that does not exist.
//
// There is no `auto` fixture any more, and that is a decision rather than an
// omission — ADR-0025 §Decision 1 carries the reasoning and its discharge by
// #120. What it costs is recorded here because here is where the case would go
// back: "a real document declaring `auto` paints its rail" is no longer asserted
// over real content. Auto SLICING is covered over synthetic MDX
// (`presentation/parser.test.tsx`, `computeSlides — auto mode`), and the rail
// over a markdown `##` by the explicit fixture below, which was chosen for
// carrying both heading sources. The rail itself reads the h2s the article
// painted, which is the same code either way. If a course document ever declares
// `auto` again, bring the case back here.
//
// Resolved through the REGISTRY, not through `walkIndex`. What these cases need
// is a document that renders, and the index decides navigation rather than
// existence (ADR-0015 §6): a document absent from it is still compiled and still
// served at `/d/<id>`. Selecting from the index conflated the two, so retiring
// the Fundamentos unit from the teaching path reddened three cases here about a
// document that had not changed at all.
const EXPLICIT_FIXTURE = 'java-tipos-y-flujo';
const explicitId = registry.get(EXPLICIT_FIXTURE)?.meta.id;

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

// Glob keys are relative to the Vite root, so they resolve against this file
// rather than the cwd — the same arithmetic `content/architecture.test.ts` uses,
// and for the same reason: `?raw` does not return MDX source (the MDX plugin
// claims the file first), so the bytes have to come off disk.
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureSource = (() => {
  const key = Object.keys(import.meta.glob('@content/courses/**/*.mdx')).find((k) =>
    k.endsWith(`${EXPLICIT_FIXTURE}.mdx`),
  );
  return key ? readFileSync(join(APP_ROOT, key), 'utf8') : '';
})();

describe('the section rail over real documents', () => {
  it('the seed course still provides the fixture these cases describe', () => {
    expect(
      explicitId,
      `${EXPLICIT_FIXTURE} left the content tree. Repoint this block at another document carrying BOTH heading sources — a markdown "##" and <Slide title> h2s — not merely at any explicit document, or the equivalence below stops being tested. Leaving the INDEX is not enough to trip this: the registry is what these cases read.`,
    ).toBeDefined();
    expect(
      registry.get(explicitId!)?.meta.presentation,
      `${EXPLICIT_FIXTURE} no longer declares explicit`,
    ).toBe('explicit');

    // The property the message above actually demands, asserted rather than
    // asked for. Declaring `explicit` is not what makes a document usable here:
    // the equivalence these cases exist for needs BOTH heading sources, and a
    // document whose h2s are all <Slide title> leaves them green and meaningless
    // — exactly what happened to this block in #108, as the header narrates.
    // Reads the source: the rendered h2s cannot tell the two sources apart,
    // which is the whole point of the equivalence.
    expect(fixtureSource, `${EXPLICIT_FIXTURE} is not readable from disk`).not.toBe('');
    expect(
      fixtureSource,
      `${EXPLICIT_FIXTURE} no longer carries a markdown "##" — repoint this block at a document that carries both sources, or the equivalence below stops being tested`,
    ).toMatch(/^## /m);
    expect(
      fixtureSource,
      `${EXPLICIT_FIXTURE} no longer carries a <Slide title> — same problem, other source`,
    ).toMatch(/<Slide title=/);
  });

  it('lists every section of a document, in order', async () => {
    // The equivalence AC4 asks for: whichever rule cut the slides, one section
    // list, because every source renders the same MDX-mapped h2 in book mode.
    // This fixture carries both — `<Slide title>` h2s and a markdown `##`.
    await renderAt(`/d/${explicitId}`);

    // The canary, inherited from the retired auto case (#102, step 3): `getAllBy`
    // cannot wait, and an `h2` exists only once the lazy document has rendered —
    // `article` does not, it is the shell's and is on this side of the boundary.
    // If the preload above is removed this fails on every machine instead of
    // reddening in CI at random.
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
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
    // Named, not discovered — the rule this file's header states, and which the
    // predicate form quietly broke: declaring `none` on a second document would
    // move this case onto it without a word.
    const FLAT_FIXTURE = 'planificacion';
    const flatId = registry.get(FLAT_FIXTURE)?.meta.id;
    expect(
      flatId,
      `${FLAT_FIXTURE} left content/ — repoint at another document with no h2 at all`,
    ).toBeDefined();
    await renderAt(`/d/${flatId}`);
    const article = await screen.findByRole('article');
    // Wait for the document itself, not just the element that will hold it.
    // Asserting straight after findByRole passed for a document that HAS
    // sections: the article exists long before its lazy chunk arrives, so the
    // rail was absent because nothing had rendered yet.
    await waitFor(() => expect(article.textContent?.trim()).not.toBe(''));
    expect(
      screen.queryByRole('navigation', { name: /en esta página/i }),
      `${FLAT_FIXTURE} grew an "##" heading, so it is no longer a document with no sections and this case is testing nothing it is named for. Either write that content without an h2 (### or a table), or move this case to another section-less document. There is no other one in content/ today — the document itself carries a note saying so.`,
    ).not.toBeInTheDocument();
  });
});
