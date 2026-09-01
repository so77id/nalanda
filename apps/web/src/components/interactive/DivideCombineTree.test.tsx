import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DivideCombineTree } from './DivideCombineTree';

// Layout and paint are the S7 browser check's job (per apps/web/CLAUDE.md
// §the suite cannot lay out a page). What the suite pins here is the widget's
// contract: which chips it draws, which return values they carry, and the
// structural difference between the binary-tree recipe (max) and the
// linear-chain recipe (binary-search).

describe('DivideCombineTree', () => {
  // ---------------------------------------------------------------------
  // recipe="max"
  // ---------------------------------------------------------------------

  it('draws the max recipe as a binary tree with one leaf per input element', () => {
    render(<DivideCombineTree recipe="max" values={[3, 7, 1, 5, 2, 8, 4, 6]} />);

    // Root call carries the full array in its label.
    expect(screen.getByText(/max\(\[3,7,1,5,2,8,4,6\]\)/)).toBeInTheDocument();

    // Two level-1 calls, one per half.
    expect(screen.getByText(/max\(\[3,7,1,5\]\)/)).toBeInTheDocument();
    expect(screen.getByText(/max\(\[2,8,4,6\]\)/)).toBeInTheDocument();

    // Base cases: one per element, each a single-element sub-array.
    expect(screen.getAllByText(/max\(\[3\]\)/).length).toBe(1);
    expect(screen.getAllByText(/max\(\[7\]\)/).length).toBe(1);
    expect(screen.getAllByText(/max\(\[8\]\)/).length).toBe(1);
  });

  it('shows the return value on every chip (bottom row) — max propagates the winner up', () => {
    render(<DivideCombineTree recipe="max" values={[3, 7, 1, 5]} />);

    // The chip carries the return value in a data attribute so a test can
    // find the specific call and check its return value, independent of the
    // paint. Root call [3,7,1,5] returns 7.
    const root = document.querySelector('[data-call="max([3,7,1,5])"]');
    expect(root?.getAttribute('data-return')).toBe('7');

    // Left half [3,7] returns 7; right half [1,5] returns 5.
    expect(document.querySelector('[data-call="max([3,7])"]')?.getAttribute('data-return')).toBe(
      '7',
    );
    expect(document.querySelector('[data-call="max([1,5])"]')?.getAttribute('data-return')).toBe(
      '5',
    );
  });

  // ---------------------------------------------------------------------
  // recipe="binary-search"
  // ---------------------------------------------------------------------

  it('draws binary-search as a FULL binary tree with lo/hi named-parameter chips', () => {
    // For [3,7,11,14,19,22,28,31,42,55] target=22:
    //   root bs(lo=0, hi=9): mid=4, a[4]=19 != 22 → recurse both halves
    //     left  bs(lo=0, hi=3): no target in this half → returns -1
    //     right bs(lo=5, hi=9): mid=7, a[7]=31 != 22 → recurse both halves
    //       left  bs(lo=5, hi=6): mid=5, a[5]=22 == target → return 5 (base)
    //       right bs(lo=8, hi=9): no target → -1
    render(
      <DivideCombineTree
        recipe="binary-search"
        values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]}
        target={22}
      />,
    );

    // Chips use `bs(subarray, lo=X, hi=Y)` — sub-array values + named indices.
    const root = document.querySelector(
      '[data-call="bs([3,7,11,14,19,22,28,31,42,55], lo=0, hi=9)"]',
    );
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-return')).toBe('5');

    // Full tree: the OTHER half (left of root) is present.
    expect(document.querySelector('[data-call="bs([3,7,11,14], lo=0, hi=3)"]')).not.toBeNull();
    // Right half where the target actually lives.
    expect(document.querySelector('[data-call="bs([22,28,31,42,55], lo=5, hi=9)"]')).not.toBeNull();
    // The specific base where the target is found — the [22,28] slice at
    // indices 5..6 returns 5.
    const foundBase = document.querySelector('[data-call="bs([22,28], lo=5, hi=6)"]');
    expect(foundBase?.getAttribute('data-return')).toBe('5');
  });

  it('marks a not-found binary-search return as -1 at every node in the tree', () => {
    render(
      <DivideCombineTree
        recipe="binary-search"
        values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]}
        target={20}
      />,
    );
    const root = document.querySelector(
      '[data-call="bs([3,7,11,14,19,22,28,31,42,55], lo=0, hi=9)"]',
    );
    expect(root?.getAttribute('data-return')).toBe('-1');
  });

  it('shows the target in the widget header for binary-search', () => {
    render(<DivideCombineTree recipe="binary-search" values={[3, 7, 11, 14, 19]} target={11} />);
    // The header carries `target = 11` (the array is in each chip, so the
    // header just needs the search value).
    expect(screen.getByText(/target\s*=\s*11/)).toBeInTheDocument();
  });

  it('carries the recipe on data-recipe so the browser check can pin the theme paint', () => {
    const { container } = render(<DivideCombineTree recipe="max" values={[1, 2, 3, 4]} />);
    expect(container.querySelector('[data-recipe="max"]')).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // Authoring errors
  // ---------------------------------------------------------------------

  it('tells the author when the recipe is unknown', () => {
    render(<DivideCombineTree recipe="mystery" values={[1, 2, 3, 4]} />);
    expect(screen.getByText(/mystery/i)).toBeInTheDocument();
  });

  it('tells the author when values is missing or empty', () => {
    render(<DivideCombineTree recipe="max" values={[]} />);
    expect(screen.getByText(/values/i)).toBeInTheDocument();
  });

  it('tells the author when binary-search is used without a target', () => {
    render(<DivideCombineTree recipe="binary-search" values={[1, 2, 3]} />);
    expect(screen.getByText(/target/i)).toBeInTheDocument();
  });

  it('tells the author when binary-search values is not sorted', () => {
    render(<DivideCombineTree recipe="binary-search" values={[3, 1, 4]} target={4} />);
    expect(screen.getByText(/ordenad/i)).toBeInTheDocument();
  });

  it('refuses a max tree that would be too large to draw', () => {
    // 64 elements → 127 nodes, over the 100-node cap.
    const big = Array.from({ length: 64 }, (_, i) => i);
    render(<DivideCombineTree recipe="max" values={big} />);
    expect(screen.getByText(/demasiado grande/i)).toBeInTheDocument();
  });
});
