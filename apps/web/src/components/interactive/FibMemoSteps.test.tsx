import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FibMemoSteps } from './FibMemoSteps';

describe('FibMemoSteps', () => {
  it('renders the first snapshot on mount: empty memo, one frame on the stack', () => {
    render(<FibMemoSteps target={5} />);
    // The first snapshot pushes fib(5) onto the stack and asks "is n < 2?".
    const frames = screen.getAllByTestId('fib-memo-frame');
    expect(frames).toHaveLength(1);
    expect(frames[0]!).toHaveTextContent(/fib\(5\)/);
    // No memo entry filled yet.
    const memoCells = screen.getAllByTestId('fib-memo-cell');
    expect(memoCells).toHaveLength(6);
    memoCells.forEach((cell) => {
      expect(cell).toHaveTextContent(/\?/);
    });
    // No done flag set yet.
    const doneCells = screen.getAllByTestId('fib-done-cell');
    expect(doneCells).toHaveLength(6);
    doneCells.forEach((cell) => {
      expect(cell).toHaveTextContent(/^F$/);
    });
  });

  it('walks the trace with the forward button and lands on a return step', async () => {
    render(<FibMemoSteps target={5} />);
    const forward = screen.getByRole('button', { name: /siguiente/i });
    // Walk to the end (well past any expected length).
    for (let i = 0; i < 200; i++) {
      const btn = screen.getByRole('button', { name: /siguiente/i }) as HTMLButtonElement;
      if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) break;
      await userEvent.click(forward);
    }
    // Terminal snapshot: memo[5] = 5. done is set only for n >= 2 (the
    // base cases 0 and 1 return early without touching the cache), so
    // done[0] = done[1] = F, done[2..5] = T.
    const memoCells = screen.getAllByTestId('fib-memo-cell');
    expect(memoCells[5]!).toHaveTextContent(/5/);
    const doneCells = screen.getAllByTestId('fib-done-cell');
    expect(doneCells[0]!).toHaveTextContent(/^F$/);
    expect(doneCells[1]!).toHaveTextContent(/^F$/);
    doneCells.slice(2).forEach((cell) => {
      expect(cell).toHaveTextContent(/^T$/);
    });
    // Final caption mentions the return value.
    expect(screen.getByText(/return 5/i)).toBeInTheDocument();
  });

  it('surfaces at least one cache hit in the fib(5) trace', async () => {
    render(<FibMemoSteps target={5} />);
    const forward = screen.getByRole('button', { name: /siguiente/i });
    let sawHit = false;
    for (let i = 0; i < 200; i++) {
      const btn = screen.getByRole('button', { name: /siguiente/i }) as HTMLButtonElement;
      if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) break;
      await userEvent.click(forward);
      if (screen.queryAllByText(/CACHE HIT/i).length > 0) {
        sawHit = true;
        // Do not break: keep walking so we finish the trace naturally.
      }
    }
    expect(sawHit).toBe(true);
  });

  it('defaults target to 5 when omitted', () => {
    render(<FibMemoSteps />);
    const memoCells = screen.getAllByTestId('fib-memo-cell');
    expect(memoCells).toHaveLength(6);
  });
});
