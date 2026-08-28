import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { RecursionTree } from './RecursionTree';

// Colour is not asserted here: jsdom lays nothing out and paints no colour, so
// the theme-aware pairs the component picks are checked in a real browser at S7
// (apps/web/CLAUDE.md §the suite cannot execute code). What the suite CAN pin
// is the identifier the colour is derived from — every node with the same
// argument carries the same `data-arg`, so a duplicate that must share a hue
// is detectable without measuring one.

describe('RecursionTree', () => {
  it('renders the full tree open by default so the duplication is visible at a glance', () => {
    // Miguel called this out at review: the reader gets more from SEEING the
    // shape all at once than from unfolding it click by click, and closed the
    // tree read as a broken widget. Everything below the root is visible on
    // mount now; the click-to-collapse behaviour stays for a reader who wants
    // to focus on a subtree.
    render(<RecursionTree recipe="fib" arg={5} />);

    expect(screen.getByText('fib(5)')).toBeInTheDocument();
    expect(screen.getAllByText('fib(4)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('fib(3)').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('fib(2)').length).toBeGreaterThanOrEqual(3);
    // Base cases visible without any click.
    expect(screen.getAllByText('fib(1)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('fib(0)').length).toBeGreaterThanOrEqual(1);
  });

  it('collapses a subtree when its root is clicked, and re-expands on a second click', async () => {
    const user = userEvent.setup();
    render(<RecursionTree recipe="fib" arg={5} />);

    const root = screen.getByRole('button', { name: /fib\(5\)/ });
    await user.click(root);
    // With everything hidden below fib(5), no other node is on the page.
    expect(screen.queryByText('fib(4)')).not.toBeInTheDocument();
    expect(screen.queryByText('fib(3)')).not.toBeInTheDocument();

    await user.click(root);
    // Second click re-reveals the full subtree.
    expect(screen.getAllByText('fib(4)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('fib(3)').length).toBeGreaterThanOrEqual(2);
  });

  it('renders base cases as leaves that cannot be clicked to expand', () => {
    // fib(0) and fib(1) return without recursing; the tree stops there. They
    // appear as plain chips, not buttons — nothing to expand.
    render(<RecursionTree recipe="fib" arg={2} />);

    expect(screen.getByText('fib(1)')).toBeInTheDocument();
    expect(screen.getByText('fib(0)')).toBeInTheDocument();
    // A base case is not a button — no expansion affordance.
    expect(screen.queryByRole('button', { name: /^fib\(1\)$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^fib\(0\)$/ })).not.toBeInTheDocument();
  });

  it('tags nodes with the same argument so a shared colour is verifiable', () => {
    // fib(3) appears twice in fib(5) — that is the whole point of the
    // visualisation. Colour reads it at a glance; this case pins the
    // identifier the colour is derived from, so a refactor cannot silently
    // break the sharing that makes the lesson land.
    const { container } = render(<RecursionTree recipe="fib" arg={5} />);

    const threes = container.querySelectorAll('[data-arg="3"]');
    expect(threes.length).toBeGreaterThanOrEqual(2);
  });

  it('supports the factorial recipe', () => {
    render(<RecursionTree recipe="factorial" arg={4} />);

    // Fully expanded by default — every step in the chain is visible.
    expect(screen.getByText('factorial(4)')).toBeInTheDocument();
    expect(screen.getByText('factorial(3)')).toBeInTheDocument();
    expect(screen.getByText('factorial(2)')).toBeInTheDocument();
    expect(screen.getByText('factorial(1)')).toBeInTheDocument();
  });

  it('shows the title when the author gives one', () => {
    render(<RecursionTree recipe="fib" arg={5} title="fib(5)" />);

    // The header renders a heading; the root sits inside it.
    const heading = screen.getByRole('heading');
    expect(within(heading).getByText('fib(5)')).toBeInTheDocument();
  });

  it('tells the author when the recipe is not one this component knows', () => {
    render(<RecursionTree recipe="mystery" arg={5} />);

    expect(screen.getByText(/mystery.*no.*recet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mystery/ })).not.toBeInTheDocument();
  });

  it('tells the author when the argument is missing or not a non-negative integer', () => {
    render(<RecursionTree recipe="fib" />);
    expect(screen.getByText(/arg/i)).toBeInTheDocument();
  });

  it('refuses to descend into a tree that would be enormous', () => {
    // A generous cap that still lets the pedagogical range through — fib(10)
    // already opens 177 nodes, and this component is not the fibonacci demo
    // (that lives in <CodeEditor> beside it in §8).
    render(<RecursionTree recipe="fib" arg={30} />);
    expect(screen.getByText(/demasiado grande/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // recipe="hanoi" — ADR-0056
  // Multi-arg recipe with `from → to` in the label and uniform coloring
  // (no repeated calls, so no color-sharing to signal).
  // ---------------------------------------------------------------------

  it('supports the hanoi recipe with 4-argument labels', () => {
    render(<RecursionTree recipe="hanoi" arg={2} />);
    // Root: hanoi(2, A→C). Two children: hanoi(1, A→B) and hanoi(1, B→C).
    // Base cases: hanoi(0, ...) — several with distinct from/to pairs.
    expect(screen.getByText('hanoi(2, A→C)')).toBeInTheDocument();
    expect(screen.getByText('hanoi(1, A→B)')).toBeInTheDocument();
    expect(screen.getByText('hanoi(1, B→C)')).toBeInTheDocument();
  });

  it('renders hanoi(2) with all three internal calls distinct', () => {
    // hanoi(2) is small enough that the three internal calls (root + two
    // children) are all unique. The pedagogical point stands even when a
    // deeper tree eventually repeats an (n, from, to, aux) tuple — hanoi is
    // void and its work is a side effect (a physical disc move) that cannot
    // be cached anyway.
    render(<RecursionTree recipe="hanoi" arg={2} />);
    expect(screen.getByText('hanoi(2, A→C)')).toBeInTheDocument();
    expect(screen.getByText('hanoi(1, A→B)')).toBeInTheDocument();
    expect(screen.getByText('hanoi(1, B→C)')).toBeInTheDocument();
  });

  it('lists hanoi among the known recipes when the author picks an unknown one', () => {
    render(<RecursionTree recipe="mystery" arg={3} />);
    expect(screen.getByText(/hanoi/i)).toBeInTheDocument();
  });

  it('uses a hanoi-specific footer explaining why memoization does not help', () => {
    render(<RecursionTree recipe="hanoi" arg={2} />);
    expect(screen.getByText(/intrínseco a Hanoi/i)).toBeInTheDocument();
  });
});
