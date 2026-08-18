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
  it('renders only the root before anyone clicks anywhere', () => {
    render(<RecursionTree recipe="fib" arg={5} />);

    expect(screen.getByText('fib(5)')).toBeInTheDocument();
    expect(screen.queryByText('fib(4)')).not.toBeInTheDocument();
    expect(screen.queryByText('fib(3)')).not.toBeInTheDocument();
  });

  it('shows the two subcalls when the root is clicked', async () => {
    const user = userEvent.setup();
    render(<RecursionTree recipe="fib" arg={5} />);

    await user.click(screen.getByRole('button', { name: /fib\(5\)/ }));

    expect(screen.getByText('fib(4)')).toBeInTheDocument();
    expect(screen.getByText('fib(3)')).toBeInTheDocument();
    // The reader has NOT asked for the grandchildren yet.
    expect(screen.queryByText('fib(2)')).not.toBeInTheDocument();
  });

  it('collapses a node when it is clicked a second time', async () => {
    const user = userEvent.setup();
    render(<RecursionTree recipe="fib" arg={5} />);

    const root = screen.getByRole('button', { name: /fib\(5\)/ });
    await user.click(root);
    await user.click(root);

    expect(screen.queryByText('fib(4)')).not.toBeInTheDocument();
    expect(screen.queryByText('fib(3)')).not.toBeInTheDocument();
  });

  it('makes the base cases visible after enough clicks, with no expand affordance', async () => {
    // fib(0) and fib(1) return without recursing; the tree stops there. What
    // the reader must see: those two leaves have no chevron and cannot be
    // clicked to reveal children they do not have.
    const user = userEvent.setup();
    render(<RecursionTree recipe="fib" arg={2} />);

    await user.click(screen.getByRole('button', { name: /fib\(2\)/ }));

    // Now fib(1) and fib(0) are both showing.
    expect(screen.getByText('fib(1)')).toBeInTheDocument();
    expect(screen.getByText('fib(0)')).toBeInTheDocument();
    // A base case is not a button — no expansion is possible.
    expect(screen.queryByRole('button', { name: /^fib\(1\)$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^fib\(0\)$/ })).not.toBeInTheDocument();
  });

  it('tags nodes with the same argument so a shared colour is verifiable', async () => {
    // fib(3) appears twice in fib(5) once the tree is expanded — that is the
    // whole point of the visualisation. Colour reads it at a glance; this case
    // pins the identifier the colour is derived from, so a refactor cannot
    // silently break the sharing that makes the lesson land.
    const user = userEvent.setup();
    const { container } = render(<RecursionTree recipe="fib" arg={5} />);

    await user.click(screen.getByRole('button', { name: /fib\(5\)/ }));
    await user.click(screen.getByRole('button', { name: /fib\(4\)/ }));

    const threes = container.querySelectorAll('[data-arg="3"]');
    expect(threes.length).toBeGreaterThanOrEqual(2);
  });

  it('supports the factorial recipe', async () => {
    const user = userEvent.setup();
    render(<RecursionTree recipe="factorial" arg={4} />);

    await user.click(screen.getByRole('button', { name: /factorial\(4\)/ }));

    expect(screen.getByText('factorial(3)')).toBeInTheDocument();
    // Single subcall, unlike fib.
    expect(screen.queryByText('factorial(2)')).not.toBeInTheDocument();
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
});
