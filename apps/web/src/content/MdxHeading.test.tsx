import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { headingFor } from './MdxHeading';

const H2 = headingFor(2);

describe('MdxHeading', () => {
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
});
