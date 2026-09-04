import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { buildTrace, MergeStepper } from './MergeStepper';

describe('MergeStepper', () => {
  it('renders two rows: a (target) and aux (copy)', () => {
    render(<MergeStepper left={[1, 4]} right={[2, 3]} />);
    expect(screen.getByTestId('merge-a')).toBeInTheDocument();
    expect(screen.getByTestId('merge-aux')).toBeInTheDocument();
  });

  it('starts with a holding the concatenation and aux empty (before the copy step)', () => {
    render(<MergeStepper left={[1, 4, 6]} right={[2, 3, 5, 7]} />);
    // a has left++right at the very first snapshot.
    expect(screen.getByTestId('merge-a-cell-0')).toHaveAttribute('data-value', '1');
    expect(screen.getByTestId('merge-a-cell-3')).toHaveAttribute('data-value', '2');
    expect(screen.getByTestId('merge-a-cell-6')).toHaveAttribute('data-value', '7');
    // aux is empty until the copy step: every cell is data-role="empty".
    for (let i = 0; i < 7; i++) {
      expect(screen.getByTestId(`merge-aux-cell-${i}`)).toHaveAttribute('data-role', 'empty');
    }
  });

  it('produces a sorted output in a equal to the merge of the two halves', () => {
    const left = [1, 4, 6];
    const right = [2, 3, 5, 7];
    const trace = buildTrace(left, right);
    const last = trace[trace.length - 1]!;
    expect(last.a).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('walks the trace and lands with a sorted in the DOM', async () => {
    render(<MergeStepper left={[1, 4]} right={[2, 3]} />);
    const forward = screen.getByRole('button', { name: /siguiente/i });
    for (let i = 0; i < 60; i++) {
      const btn = screen.getByRole('button', { name: /siguiente/i }) as HTMLButtonElement;
      if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) break;
      await userEvent.click(forward);
    }
    // After the last step, a holds 1, 2, 3, 4 in order.
    expect(screen.getByTestId('merge-a-cell-0')).toHaveAttribute('data-value', '1');
    expect(screen.getByTestId('merge-a-cell-1')).toHaveAttribute('data-value', '2');
    expect(screen.getByTestId('merge-a-cell-2')).toHaveAttribute('data-value', '3');
    expect(screen.getByTestId('merge-a-cell-3')).toHaveAttribute('data-value', '4');
  });

  it('drains the remaining side when one half is exhausted first', () => {
    // right is shorter and smaller — the trace should trip the drain
    // branches (line 6 or 7) and still end sorted.
    const trace = buildTrace([2, 3, 9, 10], [1]);
    const drainSteps = trace.filter((s) => s.line === 6 || s.line === 7);
    expect(drainSteps.length).toBeGreaterThan(0);
    const last = trace[trace.length - 1]!;
    expect(last.a).toEqual([1, 2, 3, 9, 10]);
  });

  it('uses default inputs when props are omitted', () => {
    render(<MergeStepper />);
    // Defaults are left=[1,4,6] right=[2,3,5,7] → a of size 7.
    for (let i = 0; i < 7; i++) {
      expect(screen.getByTestId(`merge-a-cell-${i}`)).toBeInTheDocument();
      expect(screen.getByTestId(`merge-aux-cell-${i}`)).toBeInTheDocument();
    }
  });

  it('splits aux at mid = left.length - 1', () => {
    const trace = buildTrace([1, 4, 6], [2, 3, 5, 7]);
    // Every snapshot carries the same mid.
    for (const s of trace) {
      expect(s.mid).toBe(2); // left.length - 1
    }
  });
});
