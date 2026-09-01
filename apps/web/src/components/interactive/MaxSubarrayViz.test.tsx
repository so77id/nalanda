import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MaxSubarrayViz, tracesMaxSubarrayDivide } from './MaxSubarrayViz';

// Same stubbing shape as BinarySearchOnArray: the code panel is <CodeStepper>
// which pulls CodeMirror. jsdom paints nothing; the widget's ask ("highlight
// these lines") is verifiable via data-highlight-lines. Real paint is the S7
// browser check.

vi.mock('./CodeStepper', () => ({
  CodeStepper: (props: { code: string; highlightLines: number[] }) => (
    <pre data-testid="code-stepper" data-highlight-lines={props.highlightLines.join(',')}>
      {props.code}
    </pre>
  ),
}));

describe('tracesMaxSubarrayDivide (the pure engine)', () => {
  it('returns the classical answer for the wikipedia test array', () => {
    // Reduced version of the wikipedia example: [-2,1,-3,4,-1,2,1,-5] — the
    // best sub-array is [3..6] = [4,-1,2,1] with sum 6.
    const trace = tracesMaxSubarrayDivide([-2, 1, -3, 4, -1, 2, 1, -5]);
    expect(trace.winner).toEqual({ sum: 6, from: 3, to: 6 });
  });

  it('handles a single-element array as a base case', () => {
    const trace = tracesMaxSubarrayDivide([7]);
    expect(trace.winner).toEqual({ sum: 7, from: 0, to: 0 });
    // The trace is one step — the base case itself.
    expect(trace.steps.length).toBe(1);
    expect(trace.steps[0]?.kind).toBe('base');
  });

  it('exposes a call path on every step so the widget can breadcrumb the depth', () => {
    // Every step in the trace should carry a `path` naming the stack of ranges
    // from the root to the current call. The base cases have path length equal
    // to the depth of the tree.
    const trace = tracesMaxSubarrayDivide([-2, 1, -3, 4]);
    for (const step of trace.steps) {
      expect(step.path.length).toBeGreaterThan(0);
      // The top of the path is always the current call frame.
      const top = step.path[step.path.length - 1]!;
      expect(top.lo).toBe(step.lo);
      expect(top.hi).toBe(step.hi);
    }
  });

  it('walks the recursion in the correct pre-order shape', () => {
    // Two-element array: [1, -3]
    //   enter [0..1] mid=0
    //     enter left  [0..0] -> base a[0]=1
    //     return-left with leftMax = {sum:1, from:0, to:0}
    //     enter right [1..1] -> base a[1]=-3
    //     return-right with rightMax = {sum:-3, from:1, to:1}
    //     cross-init
    //     cross-left-scan @ 0
    //     cross-right-scan @ 1
    //     cross-combine -> {sum:-2, from:0, to:1}
    //     winner -> {sum:1, from:0, to:0}
    const trace = tracesMaxSubarrayDivide([1, -3]);
    const kinds = trace.steps.map((s) => s.kind);
    expect(kinds).toEqual([
      'enter',
      'base',
      'return-left',
      'base',
      'return-right',
      'cross-init',
      'cross-left-scan',
      'cross-right-scan',
      'cross-combine',
      'winner',
    ]);
    expect(trace.winner).toEqual({ sum: 1, from: 0, to: 0 });
  });

  it('computes the cross scan correctly (leftBest + rightBest = crossMax)', () => {
    // For [1, 2, -1, 3] at root [0..3] mid=1:
    //   leftBest scanning from 1 down to 0: a[1]=2, sum=2, best={sum:2, from:1, to:1}
    //                                        a[0]=1, sum=3, best={sum:3, from:0, to:1}
    //   rightBest scanning from 2 up to 3: a[2]=-1, sum=-1, best={sum:-1, from:2, to:2}
    //                                       a[3]=3,  sum=2,  best={sum:2, from:2, to:3}
    //   crossMax = {sum: 3+2=5, from:0, to:3}
    const trace = tracesMaxSubarrayDivide([1, 2, -1, 3]);
    // The root-level cross-combine event carries the crossMax.
    const rootCombine = trace.steps.find(
      (s) => s.kind === 'cross-combine' && s.path.length === 1 && s.lo === 0 && s.hi === 3,
    );
    expect(rootCombine?.crossMax).toEqual({ sum: 5, from: 0, to: 3 });
    expect(trace.winner).toEqual({ sum: 5, from: 0, to: 3 });
  });
});

describe('MaxSubarrayViz', () => {
  it('renders the array cells and the code panel', () => {
    render(<MaxSubarrayViz values={[-2, 1, -3, 4, -1, 2, 1, -5]} />);

    // `-2` and `-5` are unique in the array (index labels are 0..7); the cell
    // values 1, 4 etc. also appear as index labels or in the code panel, so
    // pin the ones that do not collide.
    expect(screen.getByText('-2')).toBeInTheDocument();
    expect(screen.getByText('-5')).toBeInTheDocument();
    expect(screen.getByText('-3')).toBeInTheDocument();
    expect(screen.getByTestId('code-stepper')).toBeInTheDocument();
  });

  it('shows the initial call frame [0..7] with mid=3 highlighted', () => {
    render(<MaxSubarrayViz values={[-2, 1, -3, 4, -1, 2, 1, -5]} />);

    // The very first step is the enter of the root call.
    expect(document.querySelector('[data-lo="0"]')).not.toBeNull();
    expect(document.querySelector('[data-hi="7"]')).not.toBeNull();
    expect(document.querySelector('[data-mid="3"]')).not.toBeNull();
  });

  it('advances through the recursion when "Paso" is clicked', async () => {
    const user = userEvent.setup();
    render(<MaxSubarrayViz values={[-2, 1, -3, 4, -1, 2, 1, -5]} />);

    // First step: enter root [0..7] mid=3. Advance once: enter left child
    // [0..3] mid=1. The current call frame is what the data-lo/data-hi cells
    // paint.
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    expect(document.querySelector('[data-lo="0"]')).not.toBeNull();
    expect(document.querySelector('[data-hi="3"]')).not.toBeNull();
    expect(document.querySelector('[data-mid="1"]')).not.toBeNull();
  });

  it('announces the winner on the last step of the trace', async () => {
    const user = userEvent.setup();
    // Small array: [1, -3] — 10 steps of the shape asserted in the engine test.
    render(<MaxSubarrayViz values={[1, -3]} />);

    // 10 events; 9 clicks land on the last one.
    for (let i = 0; i < 9; i += 1) {
      await user.click(screen.getByRole('button', { name: /^paso$/i }));
    }

    // The winner is the sub-array [0..0] with sum 1. The "Mejor sub-arreglo"
    // sentence sits on the final step; assert it as one string.
    expect(screen.getByText(/mejor sub-arreglo.*\[0\.\.0\].*suma\s*=\s*1/i)).toBeInTheDocument();
  });

  it('renders the call-path breadcrumb on every step so depth is visible', async () => {
    const user = userEvent.setup();
    render(<MaxSubarrayViz values={[-2, 1, -3, 4]} />);

    // Start: root call, path length 1.
    expect(document.querySelector('[data-call-depth]')?.getAttribute('data-call-depth')).toBe('1');

    // Two clicks: we're two calls deep (enter root -> enter left child).
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    expect(document.querySelector('[data-call-depth]')?.getAttribute('data-call-depth')).toBe('2');
  });

  // ---------------------------------------------------------------------
  // Authoring errors
  // ---------------------------------------------------------------------

  it('tells the author when values is missing or too small', () => {
    render(<MaxSubarrayViz />);
    expect(screen.getByText(/values/i)).toBeInTheDocument();
  });

  it('tells the author when values is not all integers', () => {
    render(<MaxSubarrayViz values={[1, 2, 3.5, 4]} />);
    expect(screen.getByText(/enteros/i)).toBeInTheDocument();
  });

  // Regression guard for the S7 stepper-reset bug: MDX creates a fresh
  // `values` array literal on every parent render, and depending the reset
  // effect on `values` (or on a `trace` object derived from `values` without
  // memoisation) used to snap stepIndex back to 0 mid-run. A parent re-render
  // with the same content must NOT reset progress.
  it('survives a parent re-render with the same values without resetting stepIndex', async () => {
    const user = userEvent.setup();
    const values = [-2, 1, -3, 4, -1, 2, 1, -5];
    const { rerender } = render(<MaxSubarrayViz values={values} />);

    // Advance once: enter root [0..7] mid=3 → enter left [0..3] mid=1.
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    expect(document.querySelector('[data-hi="3"]')).not.toBeNull();
    expect(document.querySelector('[data-mid="1"]')).not.toBeNull();

    // Force a parent re-render with a NEW array literal that has the same
    // contents — this is exactly what MDX does when its parent re-renders.
    await act(async () => {
      rerender(<MaxSubarrayViz values={[-2, 1, -3, 4, -1, 2, 1, -5]} />);
    });

    // Still on the second step: the [0..3] mid=1 frame is what paints. If the
    // reset effect fired, mid would be 3 (root call again).
    expect(document.querySelector('[data-hi="3"]')).not.toBeNull();
    expect(document.querySelector('[data-mid="1"]')).not.toBeNull();
  });

  it('refuses arrays that would produce a trace longer than the safety cap', () => {
    // 32 elements would generate 300+ trace events. The widget refuses so a
    // long trace does not freeze the tab; the pedagogical range Miguel wants
    // (n=8) fits comfortably.
    const bigArray = Array.from({ length: 32 }, (_, i) => i - 15);
    render(<MaxSubarrayViz values={bigArray} />);
    expect(screen.getByText(/demasiado grande/i)).toBeInTheDocument();
  });
});
