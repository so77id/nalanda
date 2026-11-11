import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FibIterSteps } from './FibIterSteps';

// StepShow keeps every step's frame in the DOM, hidden, so the widget has its
// final size from the first step; what a step shows is in the current frame.
const shown = () =>
  within(document.querySelector('[data-stepshow-frame="current"]') as HTMLElement);

describe('FibIterSteps', () => {
  it('renders three cells: previous, current, next', () => {
    render(<FibIterSteps target={5} />);
    const cells = shown().getAllByTestId('fib-iter-cell');
    expect(cells).toHaveLength(3);
    expect(cells[0]!).toHaveAttribute('data-var', 'previous');
    expect(cells[1]!).toHaveAttribute('data-var', 'current');
    expect(cells[2]!).toHaveAttribute('data-var', 'next');
  });

  it('starts with previous = 0 and current = 1 initialised', () => {
    render(<FibIterSteps target={5} />);
    const cells = shown().getAllByTestId('fib-iter-cell');
    expect(cells[0]!).toHaveTextContent(/0/);
    expect(cells[1]!).toHaveTextContent(/1/);
    // next is not yet computed
    expect(cells[2]!).toHaveTextContent(/—/);
  });

  it('walks the trace and lands with current = fib(5) = 5', async () => {
    render(<FibIterSteps target={5} />);
    const forward = screen.getByRole('button', { name: /adelante/i });
    for (let i = 0; i < 40; i++) {
      const btn = screen.getByRole('button', { name: /adelante/i }) as HTMLButtonElement;
      if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) break;
      await userEvent.click(forward);
    }
    const cells = shown().getAllByTestId('fib-iter-cell');
    // After finishing fib(5): the final current holds 5.
    expect(cells[1]!).toHaveTextContent(/5/);
    // Final caption mentions the return value.
    expect(shown().getByText(/devolvemos current = 5/i)).toBeInTheDocument();
  });

  it('carries the "sin stack, sin arreglo" reminder in the footer of every step', () => {
    render(<FibIterSteps target={5} />);
    expect(shown().getByText(/sin stack, sin arreglo/i)).toBeInTheDocument();
  });

  it('defaults target to 5 when omitted', () => {
    render(<FibIterSteps />);
    const cells = shown().getAllByTestId('fib-iter-cell');
    expect(cells).toHaveLength(3);
  });

  it('honors the base case when target < 2 (target=0 shows fib(0)=0 explicitly)', () => {
    render(<FibIterSteps target={0} />);
    // The base-case snapshot names the direct return, not the two-variable
    // init the code would never run.
    expect(shown().getByText(/caso base:\s*n\s*=\s*0/i)).toBeInTheDocument();
    expect(shown().getByText(/devuelve 0/i)).toBeInTheDocument();
  });

  it('honors the base case when target = 1', () => {
    render(<FibIterSteps target={1} />);
    expect(shown().getByText(/caso base:\s*n\s*=\s*1/i)).toBeInTheDocument();
    expect(shown().getByText(/devuelve 1/i)).toBeInTheDocument();
  });
});
