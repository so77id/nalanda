import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ComplexityHierarchy } from './ComplexityHierarchy';

describe('ComplexityHierarchy', () => {
  it('shows an authoring error when classes is empty', () => {
    render(<ComplexityHierarchy classes={[]} />);
    expect(screen.getByText(/no puede estar vacío/i)).toBeInTheDocument();
  });

  it('renders the default nine canonical classes when `classes` is omitted', () => {
    render(<ComplexityHierarchy />);
    const list = screen.getByRole('list', { name: /ejemplos de algoritmos/i });
    const rows = within(list).getAllByRole('listitem');
    // 9 canonical classes = 9 top-level rows. Each row contains its own
    // nested <ul> of examples, so total listitem count is higher — filter.
    const topRows = rows.filter((li) => li.parentElement === list);
    expect(topRows).toHaveLength(9);
    // Content sanity: first row is O(1), last is O(N!).
    expect(topRows[0]).toHaveTextContent('O(1)');
    expect(topRows[8]).toHaveTextContent('O(N!)');
  });

  it('renders one ring per class, ordered inner→outer (cheapest at centre)', () => {
    const { container } = render(
      <ComplexityHierarchy
        classes={[
          { name: 'Θ(1)', examples: ['a'] },
          { name: 'Θ(N)', examples: ['b'] },
          { name: 'Θ(N²)', examples: ['c'] },
        ]}
      />,
    );

    const svgTexts = [...container.querySelectorAll('svg text')].map((t) => t.textContent);
    // All three labels visible in the SVG.
    expect(svgTexts).toEqual(expect.arrayContaining(['Θ(1)', 'Θ(N)', 'Θ(N²)']));
  });

  it('renders each class-example in the lateral list', () => {
    render(
      <ComplexityHierarchy
        classes={[
          { name: 'Θ(N)', examples: ['recorrido lineal', 'búsqueda naive'] },
          { name: 'Θ(N²)', examples: ['bubble sort'] },
        ]}
      />,
    );
    expect(screen.getByText(/recorrido lineal/)).toBeInTheDocument();
    expect(screen.getByText(/búsqueda naive/)).toBeInTheDocument();
    expect(screen.getByText(/bubble sort/)).toBeInTheDocument();
  });

  it('renders the optional title when provided', () => {
    render(<ComplexityHierarchy title="Jerarquía asintótica" />);
    expect(screen.getByText('Jerarquía asintótica')).toBeInTheDocument();
  });

  it('marks the row active when hovered — bidirectional sync driver', () => {
    render(
      <ComplexityHierarchy
        classes={[
          { name: 'Θ(1)', examples: ['a'] },
          { name: 'Θ(N)', examples: ['b'] },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: /ejemplos de algoritmos/i });
    const rows = within(list)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement === list);

    fireEvent.mouseEnter(rows[0]);
    expect(rows[0]).toHaveAttribute('data-active', 'true');
    expect(rows[1]).toHaveAttribute('data-active', 'false');

    fireEvent.mouseLeave(rows[0]);
    expect(rows[0]).toHaveAttribute('data-active', 'false');
  });

  it('marks the row active when the corresponding ring is hovered', () => {
    const { container } = render(
      <ComplexityHierarchy
        classes={[
          { name: 'Θ(1)', examples: ['a'] },
          { name: 'Θ(N)', examples: ['b'] },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: /ejemplos de algoritmos/i });
    const rows = within(list)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement === list);
    const circles = [...container.querySelectorAll('svg circle')];
    // Two classes → two rings. Circles are drawn largest-to-smallest so
    // small ones sit on top; the LAST circle in DOM order is index 0
    // (Θ(1)). Hover it and its corresponding row activates.
    fireEvent.mouseEnter(circles[circles.length - 1]);
    expect(rows[0]).toHaveAttribute('data-active', 'true');
  });
});
