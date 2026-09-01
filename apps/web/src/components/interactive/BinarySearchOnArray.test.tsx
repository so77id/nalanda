import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BinarySearchOnArray, tracesBinarySearch } from './BinarySearchOnArray';

vi.mock('./CodeStepper', () => ({
  CodeStepper: (props: { code: string; highlightLines: number[] }) => (
    <pre data-testid="code-stepper" data-highlight-lines={props.highlightLines.join(',')}>
      {props.code}
    </pre>
  ),
}));

describe('tracesBinarySearch (the pure engine)', () => {
  it('emits fine-grained steps in enter/compare/... shape for a successful search', () => {
    // target=22 in [3,7,11,14,19,22,28,31,42,55]:
    //   enter(0..9, mid=4) → compare(a[4]=19 < 22)
    //   enter(5..9, mid=7) → compare(a[7]=31 > 22)
    //   enter(5..6, mid=5) → compare(a[5]=22 == 22) → return-found → outcome
    const trace = tracesBinarySearch([3, 7, 11, 14, 19, 22, 28, 31, 42, 55], 22);
    expect(trace.outcome).toEqual({ kind: 'found', index: 5 });
    const kinds = trace.steps.map((s) => s.kind);
    expect(kinds).toEqual([
      'enter',
      'compare',
      'enter',
      'compare',
      'enter',
      'compare',
      'return-found',
      'outcome',
    ]);
    // Compare details per step
    expect(trace.steps[1]).toMatchObject({ lo: 0, hi: 9, mid: 4, comparison: 'less' });
    expect(trace.steps[3]).toMatchObject({ lo: 5, hi: 9, mid: 7, comparison: 'greater' });
    expect(trace.steps[5]).toMatchObject({ lo: 5, hi: 6, mid: 5, comparison: 'equal' });
  });

  it('emits a return-not-found step when the range empties', () => {
    // target=20 in the same array — never found; ends with lo > hi.
    const trace = tracesBinarySearch([3, 7, 11, 14, 19, 22, 28, 31, 42, 55], 20);
    expect(trace.outcome).toEqual({ kind: 'not-found' });
    const kinds = trace.steps.map((s) => s.kind);
    // Last two are return-not-found + outcome.
    expect(kinds[kinds.length - 2]).toBe('return-not-found');
    expect(kinds[kinds.length - 1]).toBe('outcome');
  });

  it('finds the target at the ends of the array (no off-by-one at lo=hi)', () => {
    expect(tracesBinarySearch([1, 2, 3, 4, 5], 1).outcome).toEqual({ kind: 'found', index: 0 });
    expect(tracesBinarySearch([1, 2, 3, 4, 5], 5).outcome).toEqual({ kind: 'found', index: 4 });
  });
});

describe('BinarySearchOnArray', () => {
  it('renders the array cells, the recursive code panel, and the initial call state', () => {
    render(<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />);

    // Array is rendered — the boundary values are visible.
    expect(screen.getByText('55')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();

    // Code panel is present with the recursive body.
    const stepper = screen.getByTestId('code-stepper');
    expect(stepper.textContent).toMatch(/return bs\(a, lo, mid - 1, t\)/);
    expect(stepper.textContent).toMatch(/return bs\(a, mid \+ 1, hi, t\)/);

    // Step 1 is `enter` on the root — every cell is inside the range so all
    // ten values are shown as active.
    const activeCells = document.querySelectorAll('[data-active="true"]');
    expect(activeCells.length).toBe(10);
  });

  it('advances one micro-step at a time — enter, then compare on the same call', async () => {
    const user = userEvent.setup();
    render(<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />);

    // Step 1: enter root (lo=0, hi=9, mid=4). No compare panel yet.
    expect(screen.queryByText('comparar')).toBeNull();

    // Step 2: compare — the compare panel appears with a[4]=19 vs target=22.
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    expect(document.querySelector('[data-panel="compare"]')).not.toBeNull();
    // The comparison headline reads the mid value and the target.
    const panel = document.querySelector('[data-panel="compare"]')!;
    expect(panel.textContent).toMatch(/a\[4\]/);
    expect(panel.textContent).toMatch(/19/);
    expect(panel.textContent).toMatch(/target/i);
    expect(panel.textContent).toMatch(/22/);
  });

  it('hides discarded cells with a dot signal after a recursive call', async () => {
    const user = userEvent.setup();
    render(<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />);

    // Advance through: enter root -> compare -> enter right child (lo=5,
    // hi=9). At that point, indices 0..4 are outside the active range.
    await user.click(screen.getByRole('button', { name: /^paso$/i })); // compare
    await user.click(screen.getByRole('button', { name: /^paso$/i })); // enter right

    // The widget marks active cells with data-active="true"; discarded ones
    // omit the attribute AND render as `·`. Count the actives.
    const active = document.querySelectorAll('[data-active="true"]');
    expect(active.length).toBe(5); // indices 5..9
  });

  it('announces the winner on the outcome step', async () => {
    const user = userEvent.setup();
    render(<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />);

    // 7 clicks reach the outcome (step 8).
    for (let i = 0; i < 7; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await user.click(screen.getByRole('button', { name: /^paso$/i }));
    }

    // The string appears twice on the outcome step (in the narration and in
    // the strong headline). Assert the count is at least 1.
    expect(screen.getAllByText(/22\s*encontrado\s*en\s*índice\s*5/i).length).toBeGreaterThan(0);
  });

  it('announces not-found with the step count when the target is absent', async () => {
    const user = userEvent.setup();
    render(<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={20} />);

    // Advance to the outcome — click many times, the widget clamps at the
    // last step.
    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await user.click(screen.getByRole('button', { name: /^paso$/i }));
    }

    expect(screen.getAllByText(/no está en el arreglo/i).length).toBeGreaterThan(0);
  });

  it('resets to the initial state when "Reset" is clicked', async () => {
    const user = userEvent.setup();
    render(<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />);
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    await user.click(screen.getByRole('button', { name: /^reset$/i }));
    // Back to step 1: all 10 cells active, no compare panel.
    expect(document.querySelectorAll('[data-active="true"]').length).toBe(10);
    expect(screen.queryByText('comparar')).toBeNull();
  });

  it('tells the author when values is missing or empty', () => {
    render(<BinarySearchOnArray target={22} />);
    expect(screen.getByText(/values/i)).toBeInTheDocument();
  });

  it('tells the author when values is not strictly increasing', () => {
    render(<BinarySearchOnArray values={[3, 7, 11, 5, 19]} target={11} />);
    expect(screen.getByText(/ordenad/i)).toBeInTheDocument();
  });

  it('tells the author when target is missing', () => {
    render(<BinarySearchOnArray values={[1, 2, 3]} />);
    expect(screen.getByText(/target/i)).toBeInTheDocument();
  });
});
