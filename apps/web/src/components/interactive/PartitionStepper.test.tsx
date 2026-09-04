import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { buildTrace, PartitionStepper } from './PartitionStepper';
import { lomutoPartition } from './sortStepperTrace';

describe('PartitionStepper', () => {
  it('renders the array with one cell per input element', () => {
    render(<PartitionStepper input={[5, 3, 8, 1, 9, 2, 7]} />);
    expect(screen.getByTestId('partition-array')).toBeInTheDocument();
    for (let i = 0; i < 7; i++) {
      expect(screen.getByTestId(`partition-cell-${i}`)).toBeInTheDocument();
    }
  });

  it('starts with the pivot at a[0] and store = 0 and no scan yet', () => {
    render(<PartitionStepper input={[5, 3, 8, 1, 9, 2, 7]} />);
    // The very first snapshot: pivot cell at index 0.
    const pivotCell = screen.getByTestId('partition-cell-0');
    expect(pivotCell).toHaveAttribute('data-role', 'pivot');
    expect(pivotCell).toHaveTextContent('5');
  });

  it("final state matches the shared Lomuto partition's result", () => {
    const input = [5, 3, 8, 1, 9, 2, 7];
    const expected = [...input];
    const expectedPivotIndex = lomutoPartition(expected, 0, expected.length - 1);

    const trace = buildTrace(input);
    const last = trace[trace.length - 1]!;
    expect(last.a).toEqual(expected);
    expect(last.pivotIndex).toBe(expectedPivotIndex);
  });

  it('walks the trace and lands with the pivot in its final position', async () => {
    render(<PartitionStepper input={[5, 3, 8, 1, 9, 2, 7]} />);
    const forward = screen.getByRole('button', { name: /siguiente/i });
    for (let i = 0; i < 60; i++) {
      const btn = screen.getByRole('button', { name: /siguiente/i }) as HTMLButtonElement;
      if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) break;
      await userEvent.click(forward);
    }
    // Everything left of the pivot is < 5; everything right is >= 5.
    const trace = buildTrace([5, 3, 8, 1, 9, 2, 7]);
    const last = trace[trace.length - 1]!;
    const pivotIdx = last.pivotIndex;
    for (let i = 0; i < pivotIdx; i++) {
      expect(last.a[i]!).toBeLessThan(5);
    }
    for (let i = pivotIdx + 1; i < last.a.length; i++) {
      expect(last.a[i]!).toBeGreaterThanOrEqual(5);
    }
  });

  it('handles a degenerate 1-element input without crashing', () => {
    render(<PartitionStepper input={[42]} />);
    expect(screen.getByTestId('partition-cell-0')).toHaveTextContent('42');
    expect(screen.getByText(/no hay nada que particionar/i)).toBeInTheDocument();
  });

  it('uses the default input when omitted', () => {
    render(<PartitionStepper />);
    // Default is length 7.
    for (let i = 0; i < 7; i++) {
      expect(screen.getByTestId(`partition-cell-${i}`)).toBeInTheDocument();
    }
  });
});
