import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { KaratsubaViz, tracesKaratsuba } from './KaratsubaViz';

vi.mock('./CodeStepper', () => ({
  CodeStepper: (props: { code: string; highlightLines: number[] }) => (
    <pre data-testid="code-stepper" data-highlight-lines={props.highlightLines.join(',')}>
      {props.code}
    </pre>
  ),
}));

describe('tracesKaratsuba (the pure engine)', () => {
  it('computes the classical example 1234 × 5678 = 7006652 with the split at m=2', () => {
    const trace = tracesKaratsuba(1234, 5678);
    // xHi=12, xLo=34, yHi=56, yLo=78, m=2, split=100
    expect(trace.split.m).toBe(2);
    expect(trace.split.pow10m).toBe(100);
    expect(trace.split.xHi).toBe(12);
    expect(trace.split.xLo).toBe(34);
    expect(trace.split.yHi).toBe(56);
    expect(trace.split.yLo).toBe(78);
    // P1 = ac = 12*56 = 672
    // P2 = bd = 34*78 = 2652
    // P3 = (a+b)(c+d) = 46*134 = 6164
    // middle = P3 - P1 - P2 = 6164 - 672 - 2652 = 2840
    // result = 672*10000 + 2840*100 + 2652 = 6720000 + 284000 + 2652 = 7006652
    expect(trace.p1).toBe(672);
    expect(trace.p2).toBe(2652);
    expect(trace.p3).toBe(6164);
    expect(trace.middle).toBe(2840);
    expect(trace.result).toBe(1234 * 5678);
    expect(trace.result).toBe(7006652);
  });

  it('handles numbers of different lengths by padding to the longer one', () => {
    // x=7 (1 digit), y=123 (3 digits) → n=3, m=2, split=100
    const trace = tracesKaratsuba(7, 123);
    expect(trace.split.m).toBe(2);
    expect(trace.result).toBe(7 * 123);
  });

  it('handles small numbers where the base case fires directly', () => {
    // 2 × 3 → n=1, m=1, and the code path short-circuits.
    const trace = tracesKaratsuba(2, 3);
    expect(trace.result).toBe(6);
  });

  it('emits steps in the expected pedagogical order (naive → pivot → 3 products → middle → reconstruct)', () => {
    const trace = tracesKaratsuba(1234, 5678);
    const kinds = trace.steps.map((s) => s.kind);
    // The trace should begin with the split and the naive expansion, then
    // the three karatsuba products, then the middle, then the reconstruction.
    expect(kinds).toContain('intro');
    expect(kinds).toContain('split');
    expect(kinds).toContain('naive-expand');
    expect(kinds).toContain('p1');
    expect(kinds).toContain('p2');
    expect(kinds).toContain('p3');
    expect(kinds).toContain('middle-formula');
    expect(kinds).toContain('reconstruct-formula');
    expect(kinds).toContain('winner');
    // p1 comes before p2 comes before p3 comes before middle comes before winner.
    expect(kinds.indexOf('p1')).toBeLessThan(kinds.indexOf('p2'));
    expect(kinds.indexOf('p2')).toBeLessThan(kinds.indexOf('p3'));
    expect(kinds.indexOf('p3')).toBeLessThan(kinds.indexOf('middle-formula'));
    expect(kinds.indexOf('middle-formula')).toBeLessThan(kinds.indexOf('winner'));
  });
});

describe('KaratsubaViz', () => {
  it('renders the code panel and the reveal panel with the initial step visible', () => {
    render(<KaratsubaViz x={1234} y={5678} />);
    expect(screen.getByTestId('code-stepper')).toBeInTheDocument();
    // Header carries the two factors — several places do, so use getAllByText.
    expect(screen.getAllByText(/1234\s*×\s*5678/).length).toBeGreaterThan(0);
  });

  it('reveals more lines as "Paso" is clicked', async () => {
    const user = userEvent.setup();
    render(<KaratsubaViz x={1234} y={5678} />);

    // Step 0 lines visible.
    const initialLines = document.querySelectorAll('[data-reveal-line]').length;

    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    await user.click(screen.getByRole('button', { name: /^paso$/i }));

    const afterTwoClicks = document.querySelectorAll('[data-reveal-line]').length;
    expect(afterTwoClicks).toBeGreaterThan(initialLines);
  });

  it('announces the final product with the check on the last step', async () => {
    const user = userEvent.setup();
    render(<KaratsubaViz x={1234} y={5678} />);

    // Advance to the end of the trace.
    for (let i = 0; i < 40; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await user.click(screen.getByRole('button', { name: /^paso$/i }));
    }

    // The winner sentence carries 7006652 (appears multiple times by the end).
    expect(screen.getAllByText(/7006652/).length).toBeGreaterThan(0);
  });

  it('shows the three karatsuba products (P1, P2, P3) once the trace has advanced past the pivot', async () => {
    const user = userEvent.setup();
    render(<KaratsubaViz x={1234} y={5678} />);
    // Advance far enough that all three products are computed and revealed.
    for (let i = 0; i < 25; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await user.click(screen.getByRole('button', { name: /^paso$/i }));
    }
    // P1, P2, P3 with concrete values.
    expect(screen.getByText(/P1.*672/)).toBeInTheDocument();
    expect(screen.getByText(/P2.*2652/)).toBeInTheDocument();
    expect(screen.getByText(/P3.*6164/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Authoring errors
  // ---------------------------------------------------------------------

  // Regression guard for the stepper-reset bug: the trace is memoised on the
  // primitive props `x` and `y`, so a parent re-render with the same values
  // must NOT reset stepIndex.
  it('survives a parent re-render with the same x/y without resetting stepIndex', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<KaratsubaViz x={1234} y={5678} />);

    // Advance twice so at least one new reveal line paints beyond the initial.
    const initialLines = document.querySelectorAll('[data-reveal-line]').length;
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    const linesAfterAdvance = document.querySelectorAll('[data-reveal-line]').length;
    expect(linesAfterAdvance).toBeGreaterThan(initialLines);

    // Force a parent re-render with the same numeric props.
    await act(async () => {
      rerender(<KaratsubaViz x={1234} y={5678} />);
    });

    // Still advanced: if the reset effect fired, the line count would drop
    // back to `initialLines`.
    expect(document.querySelectorAll('[data-reveal-line]').length).toBe(linesAfterAdvance);
  });

  it('tells the author when x or y is missing', () => {
    render(<KaratsubaViz x={1234} />);
    expect(screen.getByText(/faltan las props/i)).toBeInTheDocument();
  });

  it('tells the author when x or y is not a positive integer', () => {
    render(<KaratsubaViz x={1234} y={-5} />);
    expect(screen.getByText(/enteros? positivos?/i)).toBeInTheDocument();
  });
});
