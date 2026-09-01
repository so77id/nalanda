import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ClosestPairViz, tracesClosestPair } from './ClosestPairViz';

vi.mock('./CodeStepper', () => ({
  CodeStepper: (props: { code: string; highlightLines: number[] }) => (
    <pre data-testid="code-stepper" data-highlight-lines={props.highlightLines.join(',')}>
      {props.code}
    </pre>
  ),
}));

describe('tracesClosestPair (the pure engine)', () => {
  it('finds the closest pair by brute force when the input has 2 or 3 points', () => {
    // 2 points → 1 pair, distance = √((1-4)² + (1-5)²) = 5.
    const trace = tracesClosestPair([
      { x: 1, y: 1 },
      { x: 4, y: 5 },
    ]);
    expect(trace.winner.distance).toBeCloseTo(5, 5);
    expect(trace.winner.a).toEqual({ x: 1, y: 1 });
    expect(trace.winner.b).toEqual({ x: 4, y: 5 });
  });

  it('finds the closest pair when the answer straddles the dividing line', () => {
    // Two points close on either side of the median x.
    // Points: (0,0), (1,10), (5.1,5), (5.2,5), (10,10), (11,0)
    // After sort by x: (0,0), (1,10), (5.1,5), (5.2,5), (10,10), (11,0).
    // The closest pair is (5.1,5)-(5.2,5) with distance 0.1 — it straddles
    // the median. A widget that only searched inside the two halves would
    // miss it; the strip sweep is what finds it.
    const trace = tracesClosestPair([
      { x: 0, y: 0 },
      { x: 1, y: 10 },
      { x: 5.1, y: 5 },
      { x: 5.2, y: 5 },
      { x: 10, y: 10 },
      { x: 11, y: 0 },
    ]);
    expect(trace.winner.distance).toBeCloseTo(0.1, 3);
  });

  it('emits a full trace with enter → recurse → strip-sweep → winner shape', () => {
    // 4 points, split cleanly.
    const trace = tracesClosestPair([
      { x: 1, y: 1 },
      { x: 2, y: 4 },
      { x: 6, y: 1 },
      { x: 7, y: 4 },
    ]);
    const kinds = trace.steps.map((s) => s.kind);
    // The root call must at least emit: enter, and after both recursive
    // calls, combine, strip-init, and winner.
    expect(kinds).toContain('enter');
    expect(kinds).toContain('combine');
    expect(kinds).toContain('strip-init');
    expect(kinds).toContain('winner');
  });

  it('exposes the depth via the call path on every step', () => {
    const trace = tracesClosestPair([
      { x: 1, y: 1 },
      { x: 2, y: 4 },
      { x: 6, y: 1 },
      { x: 7, y: 4 },
    ]);
    for (const step of trace.steps) {
      expect(step.path.length).toBeGreaterThan(0);
    }
  });
});

describe('ClosestPairViz', () => {
  it('renders the SVG plane, the code panel, and the initial state', () => {
    render(
      <ClosestPairViz
        points={[
          { x: 1, y: 3 },
          { x: 2, y: 8 },
          { x: 4, y: 2 },
          { x: 5, y: 6 },
        ]}
      />,
    );

    expect(screen.getByTestId('code-stepper')).toBeInTheDocument();
    // The plane exposes a data attribute so the browser check can measure it.
    expect(document.querySelector('[data-widget="closest-pair-viz"]')).not.toBeNull();
    // Every input point is drawn as a circle.
    expect(document.querySelectorAll('[data-point]').length).toBe(4);
  });

  it('advances through the recursion when "Paso" is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ClosestPairViz
        points={[
          { x: 1, y: 3 },
          { x: 2, y: 8 },
          { x: 4, y: 2 },
          { x: 5, y: 6 },
        ]}
      />,
    );

    // Step 0 is the enter of the root call at depth 1.
    expect(document.querySelector('[data-call-depth]')?.getAttribute('data-call-depth')).toBe('1');

    // One click advances to the next step of the trace.
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    // We don't assert what the next step is beyond "the widget accepted the
    // advance" — the pure-engine test above pins the shape.
    expect(document.querySelector('[data-call-depth]')).not.toBeNull();
  });

  it('announces the winner with the euclidean distance to two decimals on the last step', async () => {
    const user = userEvent.setup();
    // Simple 3-point set with a well-known closest pair.
    // (0,0), (1,1), (10,10) → closest is (0,0)-(1,1), distance √2 ≈ 1.41.
    render(
      <ClosestPairViz
        points={[
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 10, y: 10 },
        ]}
      />,
    );

    // Advance to the end of the trace.
    const paso = () => user.click(screen.getByRole('button', { name: /^paso$/i }));
    // Enough clicks to walk past the end; the widget clamps at the last step.
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await paso();
    }

    // The winner sentence carries "Par más cercano" + the distance (2 dp).
    expect(screen.getByText(/par más cercano.*distancia\s*=\s*1\.41/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Authoring errors
  // ---------------------------------------------------------------------

  // Regression guard for the S7 stepper-reset bug: MDX creates a fresh
  // `points` array literal on every parent render. A parent re-render with
  // the same content must NOT reset progress.
  it('survives a parent re-render with the same points without resetting stepIndex', async () => {
    const user = userEvent.setup();
    const points = [
      { x: 1, y: 3 },
      { x: 2, y: 8 },
      { x: 4, y: 2 },
      { x: 5, y: 6 },
    ];
    const { rerender } = render(<ClosestPairViz points={points} />);

    // Advance twice into the recursion so depth changes off the initial 1.
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    await user.click(screen.getByRole('button', { name: /^paso$/i }));
    const depthBefore = document
      .querySelector('[data-call-depth]')
      ?.getAttribute('data-call-depth');
    expect(depthBefore).not.toBe('1');

    // Force a parent re-render with a NEW array literal (and new point
    // objects) that carries the same content — this is exactly what MDX does.
    await act(async () => {
      rerender(
        <ClosestPairViz
          points={[
            { x: 1, y: 3 },
            { x: 2, y: 8 },
            { x: 4, y: 2 },
            { x: 5, y: 6 },
          ]}
        />,
      );
    });

    // Still at the advanced step: if the reset effect fired, depth would be 1.
    expect(document.querySelector('[data-call-depth]')?.getAttribute('data-call-depth')).toBe(
      depthBefore ?? '',
    );
  });

  it('tells the author when points is missing or has fewer than 2', () => {
    render(<ClosestPairViz points={[{ x: 1, y: 1 }]} />);
    expect(screen.getByText(/points/i)).toBeInTheDocument();
  });

  it('refuses point sets that would produce a trace over the safety cap', () => {
    // A large collinear point set forces a wide strip (every point in the
    // strip is within d of the median), which produces a strip-sweep step per
    // pair per level — enough to blow the 300-step cap.
    const many = Array.from({ length: 64 }, (_, i) => ({ x: i, y: 0 }));
    render(<ClosestPairViz points={many} />);
    expect(screen.getByText(/demasiado grande/i)).toBeInTheDocument();
  });
});
