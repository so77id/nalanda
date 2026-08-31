import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RecursionTreeDivide } from './RecursionTreeDivide';

// Colour is not asserted here: jsdom lays nothing out and paints no colour, so
// the theme-aware pairs the component picks are checked in a real browser at S7
// (apps/web/CLAUDE.md §the suite cannot execute code). What the suite CAN pin
// is the identifier the colour is derived from — the `data-recipe` attribute on
// the root figure lets a browser test verify the theme paint per recipe.

describe('RecursionTreeDivide', () => {
  // ---------------------------------------------------------------------
  // recipe="max-subarray" — the reference case (T(n) = 2T(n/2) + O(n))
  // ---------------------------------------------------------------------

  it('renders the tree, the header recurrence, and the cost rail for max-subarray', () => {
    render(<RecursionTreeDivide recipe="max-subarray" n={8} />);

    // Header carries the recurrence, spelled out — this is what makes the
    // reader recognise T(n) = aT(n/b) + f(n) at a glance.
    expect(screen.getByText(/T\(n\)\s*=\s*2T\(n\/2\)\s*\+\s*O\(n\)/)).toBeInTheDocument();

    // Root chip carries T(8) — the size of the root problem.
    expect(screen.getAllByText(/T\(8\)/).length).toBeGreaterThanOrEqual(1);

    // Every level's subproblem size shows up in the tree: 8, 4, 2, 1.
    expect(screen.getAllByText(/T\(4\)/).length).toBe(2);
    expect(screen.getAllByText(/T\(2\)/).length).toBe(4);
    // Base cases: T(1). Eight of them (2^3 leaves).
    expect(screen.getAllByText(/T\(1\)/).length).toBe(8);
  });

  it("carries the combine cost inline on non-base chips (e.g. 'T(4)·O(4)')", () => {
    // The chip label is where the reader reads BOTH the subproblem size and
    // the work its combine step does — right on the node, no cross-reference
    // to the rail needed to understand a level.
    render(<RecursionTreeDivide recipe="max-subarray" n={8} />);

    // The four T(4) chips each carry `· O(4)` because f(n) = n.
    const fours = screen.getAllByText(/T\(4\)·O\(4\)/);
    expect(fours.length).toBe(2);

    // The two T(2) chips of a subtree each carry `· O(2)`.
    const twos = screen.getAllByText(/T\(2\)·O\(2\)/);
    expect(twos.length).toBe(4);
  });

  it('renders the cost rail with one row per level and the closed form at the foot', () => {
    render(<RecursionTreeDivide recipe="max-subarray" n={8} />);

    // The rail has 4 levels (log_2(8) + 1 = 4).
    // Level 0: 1 × O(8) = 8
    // Level 1: 2 × O(4) = 8
    // Level 2: 4 × O(2) = 8
    // Level 3: 8 × O(1) = 8
    const rail = screen.getByRole('table', { name: /costo por nivel/i });
    expect(within(rail).getByText(/Nivel 0/i)).toBeInTheDocument();
    expect(within(rail).getByText(/Nivel 3/i)).toBeInTheDocument();

    // Closed form printed at the foot of the rail.
    expect(within(rail).getByText(/Θ\(n\s*log\s*n\)/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // recipe="binary-search" — the linear-chain case (T(n) = T(n/2) + O(1))
  // ---------------------------------------------------------------------

  it('renders binary-search as a linear chain (one node per level)', () => {
    // BS explores ONE child per call — the tree is a linear chain of log_2(8)+1
    // = 4 nodes, honest to the recurrence 1·T(n/2) + O(1). Drawing two children
    // and shading one would misrepresent the algorithm.
    render(<RecursionTreeDivide recipe="binary-search" n={8} />);

    // Exactly ONE T(8), ONE T(4), ONE T(2), ONE T(1) — no siblings.
    expect(screen.getAllByText(/T\(8\)/).length).toBe(1);
    expect(screen.getAllByText(/T\(4\)/).length).toBe(1);
    expect(screen.getAllByText(/T\(2\)/).length).toBe(1);
    expect(screen.getAllByText(/T\(1\)/).length).toBe(1);
  });

  it('omits the inline combine cost when f = 1 (chip stays clean)', () => {
    // For binary-search and max-array (f(n) = 1), a per-chip `· O(1)` would
    // add noise without adding information — the rail carries the O(1) already.
    // Chips render just `T(k)`.
    render(<RecursionTreeDivide recipe="binary-search" n={8} />);

    // Every chip is just `T(k)`, never `T(k)·O(...)`.
    expect(screen.queryByText(/T\(\d+\)·O\(/)).not.toBeInTheDocument();
  });

  it('closes binary-search with Θ(log n)', () => {
    render(<RecursionTreeDivide recipe="binary-search" n={8} />);
    const rail = screen.getByRole('table', { name: /costo por nivel/i });
    expect(within(rail).getByText(/Θ\(log\s*n\)/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // recipe="karatsuba" — the ternary tree, exponent-drop case
  // ---------------------------------------------------------------------

  it('renders karatsuba as a ternary tree with the exponent-drop closed form', () => {
    // T(n) = 3T(n/2) + O(n). n=8: root + 3 + 9 + 27 = 40 nodes across 4 levels.
    render(<RecursionTreeDivide recipe="karatsuba" n={8} />);

    // Ternary: three children per non-base node.
    expect(screen.getAllByText(/T\(8\)/).length).toBe(1);
    expect(screen.getAllByText(/T\(4\)/).length).toBe(3);
    expect(screen.getAllByText(/T\(2\)/).length).toBe(9);
    expect(screen.getAllByText(/T\(1\)/).length).toBe(27);

    // Closed form is the exponent drop: n^log_2(3) ≈ n^1.585.
    const rail = screen.getByRole('table', { name: /costo por nivel/i });
    expect(within(rail).getByText(/Θ\(n\^\{?log_2\s*3\}?\)/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // recipe="max-array" — T(n) = 2T(n/2) + O(1), closed form Θ(n)
  // ---------------------------------------------------------------------

  it('renders max-array with the Θ(n) closed form', () => {
    render(<RecursionTreeDivide recipe="max-array" n={8} />);
    const rail = screen.getByRole('table', { name: /costo por nivel/i });
    // Closed form: leaves dominate, sum is Θ(n).
    expect(within(rail).getByText(/Θ\(n\)/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // recipe="closest-pair" — T(n) = 2T(n/2) + O(n), closed form Θ(n log n)
  // ---------------------------------------------------------------------

  it('renders closest-pair with the Θ(n log n) closed form', () => {
    render(<RecursionTreeDivide recipe="closest-pair" n={8} />);
    expect(screen.getByText(/T\(n\)\s*=\s*2T\(n\/2\)\s*\+\s*O\(n\)/)).toBeInTheDocument();
    const rail = screen.getByRole('table', { name: /costo por nivel/i });
    expect(within(rail).getByText(/Θ\(n\s*log\s*n\)/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // The recipe-identity attribute the browser check reads
  // ---------------------------------------------------------------------

  it('tags the outer figure with data-recipe so the browser check can pin each theme paint', () => {
    // The paint is theme-keyed and jsdom cannot verify it. The `data-recipe`
    // attribute lets a browser test assert "the karatsuba tree's chips paint
    // with the accent hue in both themes" without asking jsdom to see one.
    const { container } = render(<RecursionTreeDivide recipe="karatsuba" n={4} />);
    expect(container.querySelector('[data-recipe="karatsuba"]')).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // Authoring errors — every one addresses the writer, never the reader
  // ---------------------------------------------------------------------

  it('tells the author when the recipe is unknown', () => {
    render(<RecursionTreeDivide recipe="mystery" n={8} />);
    expect(screen.getByText(/mystery/i)).toBeInTheDocument();
    // Every known recipe is listed so the author knows what to switch to.
    expect(screen.getByText(/binary-search/i)).toBeInTheDocument();
    expect(screen.getByText(/karatsuba/i)).toBeInTheDocument();
  });

  it('tells the author when n is missing or not a positive integer', () => {
    render(<RecursionTreeDivide recipe="max-subarray" />);
    expect(screen.getByText(/\bn\b/i)).toBeInTheDocument();
  });

  it('tells the author when n is not a power of the recipe base', () => {
    // max-subarray divides by 2. n=7 would produce a lopsided tree; the point
    // of the pedagogical drawing is same-size partitions at every level.
    render(<RecursionTreeDivide recipe="max-subarray" n={7} />);
    expect(screen.getByText(/potencia\s+de\s+2/i)).toBeInTheDocument();
  });

  it('refuses to draw a tree that would exceed the node cap', () => {
    // karatsuba(32) = 1 + 3 + 9 + 27 + 81 + 243 = 364 nodes, over the 300 cap.
    render(<RecursionTreeDivide recipe="karatsuba" n={32} />);
    expect(screen.getByText(/demasiado grande/i)).toBeInTheDocument();
  });

  it('shows the title when the author gives one', () => {
    render(
      <RecursionTreeDivide
        recipe="max-subarray"
        n={8}
        title="Max-subarray: T(n) = 2T(n/2) + O(n)"
      />,
    );
    const heading = screen.getByRole('heading');
    expect(within(heading).getByText(/Max-subarray/)).toBeInTheDocument();
  });
});
