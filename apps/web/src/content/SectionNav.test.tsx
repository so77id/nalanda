import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SectionNav } from './SectionNav';

const SECTIONS = [
  { id: 'tipos', text: 'Tipos' },
  { id: 'memoria', text: 'Memoria' },
];

describe('SectionNav', () => {
  it('links every section to its fragment', () => {
    render(<SectionNav sections={SECTIONS} activeId={undefined} />);

    expect(screen.getByRole('link', { name: 'Tipos' })).toHaveAttribute('href', '#tipos');
    expect(screen.getByRole('link', { name: 'Memoria' })).toHaveAttribute('href', '#memoria');
  });

  it('marks the section being read for assistive technology, not only in colour', () => {
    render(<SectionNav sections={SECTIONS} activeId="memoria" />);

    expect(screen.getByRole('link', { name: 'Memoria' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Tipos' })).not.toHaveAttribute('aria-current');
  });

  it('renders nothing for a document with no sections', () => {
    // planificacion has no h2 at all: an empty "En esta página" heading
    // would be chrome announcing that there is nothing to announce.
    const { container } = render(<SectionNav sections={[]} activeId={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports a navigation so a container can react to it', async () => {
    // The drawer closes on navigation (AC2); the rail passes nothing and stays put.
    const onNavigate = vi.fn();
    render(<SectionNav sections={SECTIONS} activeId={undefined} onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole('link', { name: 'Tipos' }));
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it('names itself, so the page has two distinguishable navigations', () => {
    render(<SectionNav sections={SECTIONS} activeId={undefined} />);
    expect(screen.getByRole('navigation', { name: /en esta página/i })).toBeInTheDocument();
  });
});
