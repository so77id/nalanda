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

  it('labels a label-less entry with the registry title of its document', () => {
    renderToc('/d/bienvenida');
    // The bienvenida entry has no label: "Bienvenida" can only come from the registry.
    expect(screen.getByRole('link', { name: 'Bienvenida' })).toBeInTheDocument();
  });

  it('falls back to the raw id when the document is not in the registry', () => {
    renderToc('/d/bienvenida');
    expect(screen.getByRole('link', { name: 'doc-without-label' })).toBeInTheDocument();
  });

  it('uses a lucide marker, not the browser default triangle', () => {
    renderToc('/d/bienvenida');
    const summary = screen.getByText('Introducción').closest('summary')!;
    expect(summary.querySelector('svg'), 'no icon in the summary').not.toBeNull();
    // The default marker is drawn by list-style; left on, the page shows two.
    expect(summary.className).toContain('list-none');
  });

  it('keeps the marker in its own column, so a wrapped label keeps one left edge', () => {
    renderToc('/d/bienvenida');
    const summary = screen.getByText('Introducción').closest('summary')!;
    const marker = summary.querySelector('svg')!;
    const label = screen.getByText('Introducción');

    // The defect: with the marker as an inline sibling of a bare text node, the
    // second line of a long label starts UNDER the triangle, left of the
    // label's own first line. The text must live in its own box.
    expect(label.contains(marker)).toBe(false);
    expect(marker.parentElement).not.toBe(label);
    expect(summary.className).toContain('flex');
    expect(marker.getAttribute('class') ?? '').toContain('shrink-0');
  });

  it('indents children behind a guide line, deep enough to read as nesting', () => {
    renderToc('/d/bienvenida');
    const link = screen.getByRole('link', { name: 'Bienvenida' });
    const indent = link.closest('div')!;
    // 16px (ml-3 + pl-1) was measured too shallow to read as nesting once
    // labels wrap — and these labels wrap.
    expect(indent.className).toMatch(/border-l/);
    expect(indent.className).toMatch(/pl-4/);
  });

  it('marks the current document link', () => {
    renderToc('/d/bienvenida');
    expect(screen.getByRole('link', { name: 'Bienvenida' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
