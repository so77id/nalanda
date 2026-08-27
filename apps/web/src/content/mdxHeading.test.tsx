import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { PresentableSectionsProvider } from '../lib/presentableSections';

import { headingFor } from './mdxHeading';

const H2 = headingFor(2);
const H3 = headingFor(3);

/**
 * Renders `children` inside the shape mdxHeading sees on a real book page:
 * a `MemoryRouter` (`<Link>` needs one) and, when this document publishes a
 * presentable spine, a `PresentableSectionsProvider` around it. `docId=null`
 * models the catalog (no wrapper mounted), `docId=<id>` models a document
 * whose wrapper has published the given slugs.
 */
function renderWithContext(
  children: ReactNode,
  { docId = null, slugs = [] }: { docId?: string | null; slugs?: string[] } = {},
) {
  return render(
    <MemoryRouter>
      <PresentableSectionsProvider value={{ docId, presentableSlugs: new Set(slugs) }}>
        {children}
      </PresentableSectionsProvider>
    </MemoryRouter>,
  );
}

describe('mdxHeading', () => {
  it('gives the heading a slug id derived from its text', () => {
    renderWithContext(<H2>Búsqueda binaria</H2>);
    const heading = screen.getByRole('heading', { level: 2, name: /Búsqueda binaria/ });
    expect(heading).toHaveAttribute('id', 'busqueda-binaria');
  });

  it('renders a self-anchor pointing at the slug', () => {
    renderWithContext(<H2>La idea</H2>);
    const anchor = screen.getByRole('link', { name: /la idea/i });
    expect(anchor).toHaveAttribute('href', '#la-idea');
  });

  it('reveals the anchor to a keyboard, not only to a mouse', () => {
    renderWithContext(<H2>Una sección</H2>);
    const anchor = screen.getByRole('link');

    // The anchor is transparent while the heading is unhovered. Focusable and
    // invisible is the worst pairing: tabbing lands on it, nothing on screen
    // moves, and S4's focus outline surrounds something nobody can see.
    expect(anchor.className).toContain('group-hover:opacity-100');
    expect(anchor.className).toContain('focus-visible:opacity-100');
  });

  it('renders the anchor in a token whose contrast is guaranteed', () => {
    renderWithContext(<H2>Una sección</H2>);

    // Originally this asserted `text-slate-400` and the absence of
    // `text-slate-600`, with the ratios (7.87:1 and 2.66:1 against slate-950) in
    // a comment. That pinned a specific hex to protect a property, so it went red
    // on #109's migration even though the property still held.
    //
    // The two concerns are separated now: this case owns "the anchor takes its
    // colour from the palette's quiet text token", and `styles/palette.test.ts`
    // owns "ink-faint clears 4.5:1 on every surface, in both themes". Neither can
    // pass while the anchor is unreadable, and the ratio lives with the palette
    // that sets it rather than in a comment here that nothing re-measures.
    //
    // 4.5 and not 3: on h3/h4 the marker is normal-size text, not large.
    //
    // Split first, for the same reason as catalogRoute: `toContain` passed over
    // `text-ink-faint/10`, which Tailwind compiles to a real color-mix at 10%
    // opacity — an anchor nobody can see, shipped green. `palette.test.ts` cannot
    // catch that: it reads token DECLARATIONS out of the stylesheet, and the
    // damage here is done at the call site. Exact tokens are the only form that
    // holds, and they make the old negative assertion redundant.
    const anchor = screen.getByRole('link');
    expect(anchor.className.split(/\s+/)).toContain('text-ink-faint');
  });

  it('renders the requested heading level', () => {
    renderWithContext(<H3>Detalle</H3>);
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  });

  it('never nests anchors when the heading itself contains a link', () => {
    const { container } = renderWithContext(
      <H2>
        Intro <a href="/d/doc-a">doc</a>
      </H2>,
    );
    expect(container.querySelector('a a')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('id', 'intro');
  });
});

describe('mdxHeading — present-section button', () => {
  // The contract from S1–S4: a heading whose slug is in the PresentableSections
  // context — and only then — gets a "Presentar sección" button next to its
  // `#` anchor, linking to `?section=<slug>` on the presentation route (which
  // S2 canonicalizes to `?slide=<N>`). Catalog and non-slide headings never
  // paint it, so the same component works uniformly.

  it('paints the button next to the anchor when the slug is presentable', () => {
    renderWithContext(<H2>Tipos primitivos</H2>, {
      docId: 'java-tipos-y-flujo',
      slugs: ['tipos-primitivos'],
    });
    const link = screen.getByRole('link', { name: /presentar la sección/i });
    expect(link).toHaveAttribute('href', '/d/java-tipos-y-flujo/present?section=tipos-primitivos');
  });

  it('names the section in Spanish for a lang="es" page', () => {
    renderWithContext(<H2>La idea</H2>, { docId: 'busqueda-binaria', slugs: ['la-idea'] });
    // The accessible name is what a screen reader announces. Spanish because
    // the site is served `lang="es"` (CLAUDE.md §Language).
    expect(
      screen.getByRole('link', { name: 'Presentar la sección «La idea»' }),
    ).toBeInTheDocument();
  });

  it('reveals the button to a keyboard, not only to a mouse (same rule as the `#`)', () => {
    renderWithContext(<H2>La idea</H2>, { docId: 'doc-a', slugs: ['la-idea'] });
    const link = screen.getByRole('link', { name: /presentar la sección/i });
    // Same visibility contract as the `#` anchor — focusable-and-transparent
    // is the worst pairing (keyboard user lands on it with nothing to see).
    expect(link.className).toContain('opacity-0');
    expect(link.className).toContain('group-hover:opacity-100');
    expect(link.className).toContain('focus-visible:opacity-100');
  });

  it('does not paint the button when the slug is not in the presentable set', () => {
    // Explicit-mode fixture: a loose h2 ("Ejercicios" in java-tipos-y-flujo)
    // has an anchor but is NOT a slide. The context won't include its slug.
    renderWithContext(<H2>Ejercicios</H2>, {
      docId: 'java-tipos-y-flujo',
      slugs: ['tipos-primitivos'],
    });
    expect(screen.getByRole('link', { name: /ejercicios/i })).toHaveAttribute(
      'href',
      '#ejercicios',
    );
    expect(screen.queryByRole('link', { name: /presentar la sección/i })).not.toBeInTheDocument();
  });

  it('does not paint the button outside a DocumentPage (catalog surface)', () => {
    // `/catalog/c/slide` never mounts PresentableSectionsWrapper — the button
    // must stay silent there. The `#` anchor still paints, so we know the
    // heading is otherwise fully functional.
    renderWithContext(<H2>La idea</H2>);
    expect(screen.getByRole('link', { name: /la idea/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /presentar la sección/i })).not.toBeInTheDocument();
  });

  it('never paints on h3/h4 headings even when their slug matches', () => {
    // h3/h4 live INSIDE a slide, not as boundaries. If a coincidental slug
    // collision put them in the presentable set, they must still not get the
    // button — headingFor(2) is the only level that opens a slide.
    renderWithContext(<H3>Sub-tema</H3>, { docId: 'doc-a', slugs: ['sub-tema'] });
    expect(screen.queryByRole('link', { name: /presentar la sección/i })).not.toBeInTheDocument();
  });

  it('never paints on a heading with no sluggable text (silent fallback)', () => {
    // Same silent-fallback contract already asserted for the `#` anchor: no
    // text → no slug → no id → no button, even if a presentable set was
    // published. The two anchors track together.
    renderWithContext(
      <H2>
        <span data-testid="x" />
      </H2>,
      { docId: 'doc-a', slugs: [''] },
    );
    expect(screen.queryByRole('link', { name: /presentar la sección/i })).not.toBeInTheDocument();
  });
});
