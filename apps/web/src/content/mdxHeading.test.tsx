import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { headingFor } from './mdxHeading';

const H2 = headingFor(2);

describe('mdxHeading', () => {
  it('gives the heading a slug id derived from its text', () => {
    render(<H2>Búsqueda binaria</H2>);
    const heading = screen.getByRole('heading', { level: 2, name: /Búsqueda binaria/ });
    expect(heading).toHaveAttribute('id', 'busqueda-binaria');
  });

  it('renders a self-anchor pointing at the slug', () => {
    render(<H2>La idea</H2>);
    const anchor = screen.getByRole('link', { name: /la idea/i });
    expect(anchor).toHaveAttribute('href', '#la-idea');
  });

  it('reveals the anchor to a keyboard, not only to a mouse', () => {
    render(<H2>Una sección</H2>);
    const anchor = screen.getByRole('link');

    // The anchor is transparent while the heading is unhovered. Focusable and
    // invisible is the worst pairing: tabbing lands on it, nothing on screen
    // moves, and S4's focus outline surrounds something nobody can see.
    expect(anchor.className).toContain('group-hover:opacity-100');
    expect(anchor.className).toContain('focus-visible:opacity-100');
  });

  it('renders the anchor in a colour that clears the contrast floor', () => {
    render(<H2>Una sección</H2>);

    // slate-600 measured 2.66:1 against slate-950, below the 3:1 minimum — and
    // below 4.5:1 for h3/h4, where the marker is normal-size text rather than
    // large. slate-400 is 7.87:1, and it only ever appears once revealed.
    const anchor = screen.getByRole('link');
    expect(anchor.className).toContain('text-slate-400');
    expect(anchor.className).not.toContain('text-slate-600');
  });

  it('renders the requested heading level', () => {
    const H3 = headingFor(3);
    render(<H3>Detalle</H3>);
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  });

  it('never nests anchors when the heading itself contains a link', () => {
    const { container } = render(
      <H2>
        Intro <a href="/d/doc-a">doc</a>
      </H2>,
    );
    expect(container.querySelector('a a')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('id', 'intro');
  });
});
