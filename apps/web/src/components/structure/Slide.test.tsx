import { MDXProvider } from '@mdx-js/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { contentMdxComponents } from '../../content';
import { ModeProvider } from '../../presentation';

import { Slide } from './Slide';

describe('Slide', () => {
  it('renders title as an h2 plus flowing children in book mode', () => {
    render(
      <Slide title="La idea">
        <p>contenido</p>
      </Slide>,
    );
    expect(screen.getByRole('heading', { level: 2, name: /La idea/ })).toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });

  it('uses the MDX-mapped h2 when one is registered (anchor headings)', () => {
    render(
      <MDXProvider components={{ h2: contentMdxComponents.h2 }}>
        <Slide title="Búsqueda" />
      </MDXProvider>,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('id', 'busqueda');
  });

  it('renders children without any heading in presentation mode', () => {
    render(
      <ModeProvider mode="presentation">
        <Slide title="La idea">
          <p>contenido</p>
        </Slide>
      </ModeProvider>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });
});
