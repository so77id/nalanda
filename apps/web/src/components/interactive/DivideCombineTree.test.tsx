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

  // ---------------------------------------------------------------------
  // recipe="mergesort"
  // ---------------------------------------------------------------------

  it('draws mergesort as a binary tree with a sorted subarray on every chip', () => {
    render(<DivideCombineTree recipe="mergesort" values={[3, 7, 1, 5]} />);

    // Root call.
    const root = document.querySelector('[data-call="mergesort([3,7,1,5])"]');
    expect(root?.getAttribute('data-return')).toBe('[1,3,5,7]');

    // Two children: left half [3,7], right half [1,5].
    expect(
      document.querySelector('[data-call="mergesort([3,7])"]')?.getAttribute('data-return'),
    ).toBe('[3,7]');
    expect(
      document.querySelector('[data-call="mergesort([1,5])"]')?.getAttribute('data-return'),
    ).toBe('[1,5]');

    // Four leaves, one per element.
    expect(document.querySelector('[data-call="mergesort([3])"]')).not.toBeNull();
    expect(document.querySelector('[data-call="mergesort([7])"]')).not.toBeNull();
    expect(document.querySelector('[data-call="mergesort([1])"]')).not.toBeNull();
    expect(document.querySelector('[data-call="mergesort([5])"]')).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // recipe="quicksort"
  // ---------------------------------------------------------------------

  it('draws quicksort with pivot=a[0] and exposes pivot as an intermediate on internal chips', () => {
    // Pivot policy: first element of the subarray.
    // quicksort([3,7,1,5]): pivot=3 → left=[1], right=[7,5]
    //   left  quicksort([1]) base
    //   right quicksort([7,5]): pivot=7 → left=[5], right=[] → base+base
    render(<DivideCombineTree recipe="quicksort" values={[3, 7, 1, 5]} />);

    const root = document.querySelector('[data-call="quicksort([3,7,1,5])"]');
    expect(root?.getAttribute('data-return')).toBe('[1,3,5,7]');
    // Middle row of the root chip carries pivot=3.
    expect(root?.textContent).toMatch(/pivot=3/);

    // Right subtree — pivot 7, right child empty.
    expect(document.querySelector('[data-call="quicksort([7,5])"]')?.textContent).toMatch(
      /pivot=7/,
    );
    expect(document.querySelector('[data-call="quicksort([])"]')?.getAttribute('data-return')).toBe(
      '[]',
    );
  });

  // ---------------------------------------------------------------------
  // highlightNode + nodeAnnotations (used by <SortStepper>)
  // ---------------------------------------------------------------------

  it('marks the chip whose call matches highlightNode with data-highlighted', () => {
    render(
      <DivideCombineTree
        recipe="mergesort"
        values={[3, 7, 1, 5]}
        highlightNode="mergesort([3,7])"
      />,
    );
    const highlighted = document.querySelector('[data-highlighted="true"]');
    expect(highlighted).not.toBeNull();
    expect(highlighted?.getAttribute('data-call')).toBe('mergesort([3,7])');
    // No other chip is highlighted.
    expect(document.querySelectorAll('[data-highlighted="true"]').length).toBe(1);
  });

  it('renders no highlight when highlightNode is absent or matches no chip', () => {
    const { rerender } = render(<DivideCombineTree recipe="mergesort" values={[3, 7]} />);
    expect(document.querySelectorAll('[data-highlighted="true"]').length).toBe(0);

    rerender(
      <DivideCombineTree recipe="mergesort" values={[3, 7]} highlightNode="mergesort([9,9])" />,
    );
    expect(document.querySelectorAll('[data-highlighted="true"]').length).toBe(0);
  });

  it('overrides the middle row of a chip when nodeAnnotations names its call', () => {
    render(
      <DivideCombineTree
        recipe="mergesort"
        values={[3, 7, 1, 5]}
        nodeAnnotations={{ 'mergesort([3,7,1,5])': 'combinando [3,7]+[1,5]' }}
      />,
    );
    const root = document.querySelector('[data-call="mergesort([3,7,1,5])"]');
    expect(root?.textContent).toMatch(/combinando \[3,7\]\+\[1,5\]/);
  });

  it('leaves existing recipes unchanged when the new props are absent', () => {
    // Regression guard for ADR-0063 recipes: max still renders and picks the
    // winner, no data-highlighted anywhere.
    render(<DivideCombineTree recipe="max" values={[3, 7, 1, 5]} />);
    expect(document.querySelectorAll('[data-highlighted="true"]').length).toBe(0);
    expect(
      document.querySelector('[data-call="max([3,7,1,5])"]')?.getAttribute('data-return'),
    ).toBe('7');
  });
});
