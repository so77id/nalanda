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
