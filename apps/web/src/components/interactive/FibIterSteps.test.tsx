import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FibIterSteps } from './FibIterSteps';

describe('FibIterSteps', () => {
  it('renders three cells: previous, current, next', () => {
    render(<FibIterSteps target={5} />);
    const cells = screen.getAllByTestId('fib-iter-cell');
    expect(cells).toHaveLength(3);
    expect(cells[0]!).toHaveAttribute('data-var', 'previous');
    expect(cells[1]!).toHaveAttribute('data-var', 'current');
    expect(cells[2]!).toHaveAttribute('data-var', 'next');
  });

  it('starts with previous = 0 and current = 1 initialised', () => {
    render(<FibIterSteps target={5} />);
    const cells = screen.getAllByTestId('fib-iter-cell');
    expect(cells[0]!).toHaveTextContent(/0/);
    expect(cells[1]!).toHaveTextContent(/1/);
    // next is not yet computed
    expect(cells[2]!).toHaveTextContent(/—/);
  });

  it('walks the trace and lands with current = fib(5) = 5', async () => {
    render(<FibIterSteps target={5} />);
    const forward = screen.getByRole('button', { name: /siguiente/i });
    for (let i = 0; i < 40; i++) {
      const btn = screen.getByRole('button', { name: /siguiente/i }) as HTMLButtonElement;
      if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) break;
      await userEvent.click(forward);
    }
    const cells = screen.getAllByTestId('fib-iter-cell');
    // After finishing fib(5): the final current holds 5.
    expect(cells[1]!).toHaveTextContent(/5/);
    // Final caption mentions the return value.
    expect(screen.getByText(/devolvemos current = 5/i)).toBeInTheDocument();
  });

  it('carries the "sin stack, sin arreglo" reminder in the footer of every step', () => {
    render(<FibIterSteps target={5} />);
    expect(screen.getByText(/sin stack, sin arreglo/i)).toBeInTheDocument();
  });

  it('defaults target to 5 when omitted', () => {
    render(<FibIterSteps />);
    const cells = screen.getAllByTestId('fib-iter-cell');
    expect(cells).toHaveLength(3);
  });
});
