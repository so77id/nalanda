import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BinarySearchOnArray, tracesBinarySearch } from './BinarySearchOnArray';

// CodeMirror is stubbed in vitest.setup.ts (jsdom lays nothing out and paints
// no syntax highlighting) so tests here pin the widget's contract: the trace
// engine, the step controls, the array cells and the accessibility hooks
// (data-lo, data-mid, data-hi). Real syntax highlighting and the active-line
// paint are the S7 browser check's job — same shape as <CallStack>.

vi.mock('./CodeStepper', () => ({
  // A stub that renders the code as a bare <pre> AND exposes the active-line
  // list so behaviour tests can pin what the widget asked to be highlighted.
  CodeStepper: (props: { code: string; highlightLines: number[] }) => (
    <pre data-testid="code-stepper" data-highlight-lines={props.highlightLines.join(',')}>
      {props.code}
    </pre>
  ),
}));

describe('tracesBinarySearch (the pure engine)', () => {
  it('generates the classical mid=(lo+hi)/2 trace for a value in the middle', () => {
    // values = [3, 7, 11, 14, 19, 22, 28, 31, 42, 55]; target=22 (index 5).
    // Step 1: lo=0 hi=9 mid=4 -> a[4]=19 < 22 -> lo=5
    // Step 2: lo=5 hi=9 mid=7 -> a[7]=31 > 22 -> hi=6
    // Step 3: lo=5 hi=6 mid=5 -> a[5]=22 == 22 -> found at 5
    const trace = tracesBinarySearch([3, 7, 11, 14, 19, 22, 28, 31, 42, 55], 22);

    expect(trace.outcome).toEqual({ kind: 'found', index: 5 });
    expect(trace.steps.length).toBe(3);
    expect(trace.steps[0]).toMatchObject({ lo: 0, hi: 9, mid: 4, comparison: 'less' });
    expect(trace.steps[1]).toMatchObject({ lo: 5, hi: 9, mid: 7, comparison: 'greater' });
    expect(trace.steps[2]).toMatchObject({ lo: 5, hi: 6, mid: 5, comparison: 'equal' });
  });

  it('generates a not-found trace that ends when lo > hi', () => {
    // target=20 in the same array: not present.
    // Step 1: lo=0 hi=9 mid=4 -> a[4]=19 < 20 -> lo=5
    // Step 2: lo=5 hi=9 mid=7 -> a[7]=31 > 20 -> hi=6
    // Step 3: lo=5 hi=6 mid=5 -> a[5]=22 > 20 -> hi=4
    // Terminate: lo=5 > hi=4 -> not found
    const trace = tracesBinarySearch([3, 7, 11, 14, 19, 22, 28, 31, 42, 55], 20);

    expect(trace.outcome).toEqual({ kind: 'not-found' });
    expect(trace.steps.length).toBe(3);
    // The comparison of the LAST step points at 22 > 20.
    expect(trace.steps[2]).toMatchObject({ mid: 5, comparison: 'greater' });
  });

  it('finds the target at the ends of the array (no off-by-one at lo=hi)', () => {
    // target at the very first position.
    const first = tracesBinarySearch([1, 2, 3, 4, 5], 1);
    expect(first.outcome).toEqual({ kind: 'found', index: 0 });

    // target at the very last position.
    const last = tracesBinarySearch([1, 2, 3, 4, 5], 5);
    expect(last.outcome).toEqual({ kind: 'found', index: 4 });
  });
});

describe('BinarySearchOnArray', () => {
  it('renders the array cells, the code panel, and the initial lo/hi labels', () => {
    render(<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />);

    // Array is rendered — every value visible. `3` collides with the index
    // label below the first cell, so we pin the unique values here.
    expect(screen.getByText('55')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();

    // Code panel is present.
    expect(screen.getByTestId('code-stepper')).toBeInTheDocument();

    // On step 0 (initial state before pressing "Paso") the widget shows the
    // initial rango — lo=0, hi=9, mid=4. All three markers land on cells.
    // The test pins them via the semantic data attributes; the arrows are the
    // browser check's job.
    expect(document.querySelector('[data-lo="0"]')).not.toBeNull();
    expect(document.querySelector('[data-hi="9"]')).not.toBeNull();
    expect(document.querySelector('[data-mid="4"]')).not.toBeNull();
  });

  it('advances one step at a time when "Paso" is clicked and updates lo/mid/hi', async () => {
    const user = userEvent.setup();
    render(<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />);

    // After ONE click on Paso: lo=5, hi=9, mid=7 (the second step of the trace
    // becomes the "current" one).
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    expect(document.querySelector('[data-lo="5"]')).not.toBeNull();
    expect(document.querySelector('[data-hi="9"]')).not.toBeNull();
    expect(document.querySelector('[data-mid="7"]')).not.toBeNull();
  });

  it('announces the successful outcome with the total step count when the last step lands', async () => {
    const user = userEvent.setup();
    render(<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />);

    // Two clicks on Paso -> current step is the third and last one (found).
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    await user.click(screen.getByRole('button', { name: /^paso$/i }));

    // The outcome panel says "encontrado en índice 5 en 3 pasos" (or similar
    // wording that carries both facts).
    expect(screen.getByText(/índice 5/i)).toBeInTheDocument();
    expect(screen.getByText(/3\s*pasos/i)).toBeInTheDocument();
  });

  it('announces the not-found outcome with the step count when target is absent', async () => {
    const user = userEvent.setup();
    render(<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={20} />);

    // Two clicks: current step is the third (last) — the outcome panel reports
    // 3 pasos, no encontrado. The message emphasises the count on purpose:
    // found and not-found take the SAME number of comparisons in BS.
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    await user.click(screen.getByRole('button', { name: /^paso$/i }));

    expect(screen.getByText(/no está en el arreglo/i)).toBeInTheDocument();
    expect(screen.getByText(/3\s*pasos/i)).toBeInTheDocument();
  });

  it('resets to the initial rango when "Reset" is clicked', async () => {
    const user = userEvent.setup();
    render(<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />);
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    await user.click(screen.getByRole('button', { name: /^reset$/i }));

    // Back to the initial state.
    expect(document.querySelector('[data-lo="0"]')).not.toBeNull();
    expect(document.querySelector('[data-hi="9"]')).not.toBeNull();
    expect(document.querySelector('[data-mid="4"]')).not.toBeNull();
  });

  it('rewinds one step at a time when "Atrás" is clicked', async () => {
    const user = userEvent.setup();
    render(<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />);
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    await user.click(screen.getByRole('button', { name: /atrás/i }));
    // Back to step 1: lo=5, hi=9, mid=7.
    expect(document.querySelector('[data-lo="5"]')).not.toBeNull();
    expect(document.querySelector('[data-hi="9"]')).not.toBeNull();
    expect(document.querySelector('[data-mid="7"]')).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // Authoring errors — every one addresses the author, never the reader
  // ---------------------------------------------------------------------

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
