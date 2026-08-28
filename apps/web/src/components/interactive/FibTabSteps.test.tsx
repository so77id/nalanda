import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FibTabSteps } from './FibTabSteps';

describe('FibTabSteps', () => {
  it('renders the first snapshot with the array fully empty', () => {
    render(<FibTabSteps target={5} />);
    const cells = screen.getAllByTestId('fib-tab-cell');
    expect(cells).toHaveLength(6);
    cells.forEach((cell) => {
      expect(cell).toHaveTextContent(/\?/);
    });
    // The first snapshot is the array allocation, before any i loop.
    expect(screen.getByText(/Inicialización/i)).toBeInTheDocument();
  });

  it('walks to the end and lands with the full array filled and fib(5) = 5', async () => {
    render(<FibTabSteps target={5} />);
    const forward = screen.getByRole('button', { name: /siguiente/i });
    for (let i = 0; i < 40; i++) {
      const btn = screen.getByRole('button', { name: /siguiente/i }) as HTMLButtonElement;
      if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) break;
      await userEvent.click(forward);
    }
    const cells = screen.getAllByTestId('fib-tab-cell');
    // Fibonacci sequence 0, 1, 1, 2, 3, 5 for f[0..5].
    expect(cells[0]!).toHaveTextContent(/0/);
    expect(cells[1]!).toHaveTextContent(/1/);
    expect(cells[2]!).toHaveTextContent(/1/);
    expect(cells[3]!).toHaveTextContent(/2/);
    expect(cells[4]!).toHaveTextContent(/3/);
    expect(cells[5]!).toHaveTextContent(/5/);
    // Final caption mentions the return value.
    expect(screen.getByText(/devolvemos f\[5\] = 5/i)).toBeInTheDocument();
  });

  it('has no stack column at any step — the point of tabulation', async () => {
    render(<FibTabSteps target={5} />);
    // A quick sanity check: the visual carries the caption that no stack
    // is used, and no fib-memo-frame test id appears.
    expect(screen.getByText(/sin stack de llamadas/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId('fib-memo-frame')).toHaveLength(0);
  });

  it('defaults target to 5 when omitted', () => {
    render(<FibTabSteps />);
    const cells = screen.getAllByTestId('fib-tab-cell');
    expect(cells).toHaveLength(6);
  });
});
