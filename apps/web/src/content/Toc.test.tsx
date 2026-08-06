import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { Toc } from './Toc';
import { parseCourseIndex } from './courseIndex';

const index = parseCourseIndex(
  [
    'entries:',
    '  - label: Introducción',
    '    levelName: Unidad',
    '    children:',
    '      - docId: bienvenida',
    '  - docId: doc-without-label',
  ].join('\n'),
  'index.yaml',
);

function renderToc(at: string) {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Toc index={index} />
    </MemoryRouter>,
  );
}

describe('Toc', () => {
  it('renders groups and document links following the index nesting', () => {
    renderToc('/d/bienvenida');
    expect(screen.getByText('Introducción')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Bienvenida' });
    expect(link).toHaveAttribute('href', '/d/bienvenida');
  });

  it('labels documents with the registry title when the entry has no label', () => {
    renderToc('/d/bienvenida');
    // doc-without-label is not in the registry: it must fall back to the raw id.
    expect(screen.getByRole('link', { name: 'doc-without-label' })).toBeInTheDocument();
  });

  it('marks the current document link', () => {
    renderToc('/d/bienvenida');
    expect(screen.getByRole('link', { name: 'Bienvenida' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
