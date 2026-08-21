import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MathPlot } from './MathPlot';

// Nivo Line renders SVG that needs a real ResponsiveContainer measurement
// (uses `use-resize-observer` under the hood — vitest.setup.ts polyfills the
// ResizeObserver global, but Nivo's Responsive wrapper still bails to a
// fallback when it cannot measure). We stub the Line to a marker element and
// assert what the widget HANDS to it — same shape as the Mafs stub before.
vi.mock('@nivo/line', () => ({
  ResponsiveLine: ({
    data,
    colors,
    yScale,
    axisLeft,
  }: {
    data: { id: string; data: unknown[] }[];
    colors: string[];
    yScale: unknown;
    axisLeft: unknown;
  }) => (
    <div
      data-testid="nivo-line"
      data-series-count={data.length}
      data-series-ids={data.map((d) => d.id).join('|')}
      data-first-series-points={data[0]?.data.length ?? 0}
      data-colors={colors.join('|')}
      data-y-scale={JSON.stringify(yScale)}
      data-axis-left={JSON.stringify(axisLeft)}
    />
  ),
}));

describe('MathPlot', () => {
  it('shows an authoring error when type is 3d (not implemented)', () => {
    render(<MathPlot type="3d" xRange={[0, 10]} functions={[]} />);
    expect(screen.getByText(/aún no está implementado/i)).toBeInTheDocument();
    expect(screen.queryByTestId('nivo-line')).not.toBeInTheDocument();
  });

  it('shows an authoring error when functions is missing', () => {
    render(<MathPlot type="curves" xRange={[0, 10]} />);
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
  });

  it('shows an authoring error when xRange is missing', () => {
    render(<MathPlot type="curves" functions={[{ label: 'f', fn: (x) => x }]} />);
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
    expect(screen.getByText('xRange')).toBeInTheDocument();
  });

  it('samples every function across xRange and hands the points to Nivo', () => {
    render(
      <MathPlot
        type="curves"
        xRange={[0, 10]}
        functions={[
          { label: 'f', fn: (x) => x },
          { label: 'g', fn: (x) => x * x },
        ]}
        samples={100}
      />,
    );

    const chart = screen.getByTestId('nivo-line');
    expect(chart).toHaveAttribute('data-series-count', '2');
    expect(chart).toHaveAttribute('data-series-ids', 'f|g');
    // 101 samples = samples+1 (endpoints inclusive)
    expect(chart).toHaveAttribute('data-first-series-points', '101');
  });

  it('honours the picked colour for a series', () => {
    render(
      <MathPlot
        type="curves"
        xRange={[0, 10]}
        functions={[{ label: 'f', fn: (x) => x, color: 'red' }]}
      />,
    );
    const chart = screen.getByTestId('nivo-line');
    const colors = (chart.getAttribute('data-colors') ?? '').split('|');
    // The picked colour uses `light-dark(...)` so both themes render right.
    expect(colors[0]).toContain('light-dark');
    expect(colors[0]).toContain('#dc2626');
  });

  it('transforms functions through log10 when scale="log"', () => {
    render(
      <MathPlot
        type="curves"
        xRange={[1, 100]}
        yRange={[1, 10000]}
        scale="log"
        functions={[{ label: 'n^2', fn: (x) => x * x }]}
      />,
    );
    const chart = screen.getByTestId('nivo-line');
    // yRange [1, 10000] in original units → [0, 4] in log10 space.
    const yScale = JSON.parse(chart.getAttribute('data-y-scale') ?? '{}');
    expect(yScale.min).toBeCloseTo(0);
    expect(yScale.max).toBeCloseTo(4);
    // The axis's format function goes into `axisLeft.format`; the stub
    // dropped it (functions do not serialise), but the axis is present with
    // its legend text.
    const axisLeft = JSON.parse(chart.getAttribute('data-axis-left') ?? '{}');
    expect(axisLeft.legend).toBe('costo');
  });

  it('paints the title as a header when provided', () => {
    render(
      <MathPlot
        type="curves"
        title="Órdenes de crecimiento"
        xRange={[0, 10]}
        functions={[{ label: 'f', fn: (x) => x }]}
      />,
    );
    expect(screen.getByText(/Órdenes de crecimiento/)).toBeInTheDocument();
  });

  it('marks the widget with data-mathplot-scale so the suite can pin it', () => {
    const { container } = render(
      <MathPlot
        type="curves"
        scale="log"
        xRange={[1, 100]}
        yRange={[1, 100]}
        functions={[{ label: 'f', fn: (x) => x }]}
      />,
    );
    const figure = container.querySelector('[data-mathplot-scale]');
    expect(figure).toHaveAttribute('data-mathplot-scale', 'log');
  });
});
