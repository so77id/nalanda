import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DecisionTreeSort } from './DecisionTreeSort';

describe('DecisionTreeSort', () => {
  it('refuses n outside {2,3,4}', () => {
    render(<DecisionTreeSort n={5 as unknown as 4} />);
    expect(screen.getByText(/2, 3 o 4/i)).toBeInTheDocument();
  });

  it('renders one internal chip per comparison (n=3 → up to 5 internals) and 6 leaves', () => {
    const { container } = render(<DecisionTreeSort n={3} />);
    expect(container.querySelectorAll('[data-decision-node="leaf"]').length).toBe(6);
    // At least one internal (root). The balanced tree can vary the internal
    // count, but there must be at least one.
    expect(container.querySelectorAll('[data-decision-node="internal"]').length).toBeGreaterThan(0);
  });

  it('renders 24 leaves for n=4', () => {
    const { container } = render(<DecisionTreeSort n={4} />);
    expect(container.querySelectorAll('[data-decision-node="leaf"]').length).toBe(24);
  });

  it('every leaf carries a distinct data-sorted string', () => {
    const { container } = render(<DecisionTreeSort n={4} />);
    const leaves = Array.from(container.querySelectorAll('[data-sorted]'));
    const set = new Set(leaves.map((l) => l.getAttribute('data-sorted')));
    expect(set.size).toBe(leaves.length);
    expect(set.size).toBe(24);
  });

  it('the data panel names ⌈log₂(N!)⌉ = 3 for n=3', () => {
    const { container } = render(<DecisionTreeSort n={3} />);
    const bound = container.querySelector('[data-panel="bound"]');
    expect(bound?.textContent).toMatch(/log₂\(3!\)/);
    expect(bound?.textContent).toMatch(/3/);
    expect(container.querySelector('[data-panel="leaves"]')?.textContent).toMatch(/6/);
  });

  it('shows and hides the worst-case highlight on button toggle', () => {
    const { container } = render(<DecisionTreeSort n={3} />);
    // Initially hidden — no leaf is highlighted.
    expect(
      container.querySelectorAll('[data-decision-node="leaf"][data-highlighted="true"]').length,
    ).toBe(0);
    // Toggle on.
    const button = screen.getByRole('button', { name: /Mostrar peor caso/i });
    fireEvent.click(button);
    // Exactly one leaf is highlighted after toggling.
    expect(
      container.querySelectorAll('[data-decision-node="leaf"][data-highlighted="true"]').length,
    ).toBe(1);
    // Toggle off.
    fireEvent.click(screen.getByRole('button', { name: /Ocultar peor caso/i }));
    expect(
      container.querySelectorAll('[data-decision-node="leaf"][data-highlighted="true"]').length,
    ).toBe(0);
  });

  it('the highlighted leaf sits at the tree height (worst case is deepest)', () => {
    const { container } = render(<DecisionTreeSort n={4} />);
    fireEvent.click(screen.getByRole('button', { name: /Mostrar peor caso/i }));
    const leaves = Array.from(container.querySelectorAll('[data-decision-node="leaf"]'));
    const maxDepth = Math.max(...leaves.map((l) => Number(l.getAttribute('data-depth'))));
    const highlighted = container.querySelector(
      '[data-decision-node="leaf"][data-highlighted="true"]',
    );
    expect(Number(highlighted?.getAttribute('data-depth'))).toBe(maxDepth);
  });

  it('hides the data panel when showBound=false', () => {
    const { container } = render(<DecisionTreeSort n={3} showBound={false} />);
    expect(container.querySelector('[data-panel="bound"]')).toBeNull();
  });
});
