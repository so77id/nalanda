import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MathPlot } from './MathPlot';

// Mafs renders SVG through a coordinate transform pipeline jsdom cannot lay
// out — the tests pin what the component DECLARES (the reference lines it
// draws, the legend it renders, the auto-y-range it computes) with the
// library replaced by stubs. The paint itself is confirmed in a real browser
// at the WP's S10 browser check.
vi.mock('mafs', () => ({
  Mafs: ({ children, viewBox }: { children: React.ReactNode; viewBox: unknown }) => (
    <div data-testid="mafs" data-viewbox={JSON.stringify(viewBox)}>
      {children}
    </div>
  ),
  Coordinates: {
    Cartesian: () => <div data-testid="cartesian" />,
  },
  Plot: {
    OfX: ({ y, color, style }: { y: (x: number) => number; color: string; style: string }) => (
      <div
        data-testid="plot-of-x"
        data-color={color}
        data-style={style}
        data-y-at-1={String(y(1))}
      />
    ),
  },
  Line: {
    Segment: ({ point1, point2, color }: { point1: [number, number]; point2: [number, number]; color: string }) => (
      <div
        data-testid="line-segment"
        data-point1={JSON.stringify(point1)}
        data-point2={JSON.stringify(point2)}
        data-color={color}
      />
    ),
  },
  Text: ({ x, y, children }: { x: number; y: number; children: React.ReactNode }) => (
    <div data-testid="text" data-x={x} data-y={y}>
      {children}
    </div>
  ),
  Theme: {
    blue: '#0b5fff',
    green: '#0fa958',
    red: '#e01e37',
    orange: '#f57e17',
    purple: '#8256d0',
    pink: '#ff5c8a',
    indigo: '#4c3fa4',
    yellow: '#d9b400',
    foreground: '#111827',
  },
}));

describe('MathPlot', () => {
  it('shows an authoring error when type is 3d (not implemented)', () => {
    render(<MathPlot type="3d" xRange={[0, 10]} functions={[]} />);
    expect(screen.getByText(/aún no está implementado/i)).toBeInTheDocument();
    expect(screen.queryByTestId('mafs')).not.toBeInTheDocument();
  });

  it('shows an authoring error when functions is missing', () => {
    render(<MathPlot type="curves" xRange={[0, 10]} />);
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
  });

  it('shows an authoring error when xRange is missing', () => {
    render(<MathPlot type="curves" functions={[{ label: 'f', fn: (x) => x }]} />);
    // The message spans a <code> element, so match on visible fragments
    // separately rather than the whole sentence.
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
    expect(screen.getByText('xRange')).toBeInTheDocument();
  });

  it('paints one Plot.OfX per function with the color rotation when none is specified', () => {
    render(
      <MathPlot
        type="curves"
        xRange={[0, 10]}
        functions={[
          { label: 'f', fn: (x) => x },
          { label: 'g', fn: (x) => x * x },
        ]}
      />,
    );

    const plots = screen.getAllByTestId('plot-of-x');
    expect(plots).toHaveLength(2);
    // First curve gets the first colour in the rotation (blue), second gets the second (green).
    expect(plots[0]).toHaveAttribute('data-color', '#0b5fff');
    expect(plots[1]).toHaveAttribute('data-color', '#0fa958');
    // The functions themselves reach the plotter — a passing value proves the
    // callback is threaded through, not replaced.
    expect(plots[0]).toHaveAttribute('data-y-at-1', '1');
    expect(plots[1]).toHaveAttribute('data-y-at-1', '1');
  });

  it('honours the picked color when the author names one', () => {
    render(
      <MathPlot
        type="curves"
        xRange={[0, 10]}
        functions={[{ label: 'f', fn: (x) => x, color: 'red' }]}
      />,
    );

    expect(screen.getByTestId('plot-of-x')).toHaveAttribute('data-color', '#e01e37');
  });

  it('renders a dashed curve when dashed=true', () => {
    render(
      <MathPlot
        type="curves"
        xRange={[0, 10]}
        functions={[{ label: 'f', fn: (x) => x, dashed: true }]}
      />,
    );

    expect(screen.getByTestId('plot-of-x')).toHaveAttribute('data-style', 'dashed');
  });

  it('paints an annotation as a line segment when the author asks for a vertical line', () => {
    render(
      <MathPlot
        type="curves"
        xRange={[0, 10]}
        yRange={[0, 20]}
        functions={[{ label: 'f', fn: (x) => x }]}
        annotations={[{ type: 'verticalLine', x: 4, label: 'N₀' }]}
      />,
    );

    const segments = screen.getAllByTestId('line-segment');
    expect(segments).toHaveLength(1);
    // The vertical line stretches from y=0 to y=20 at x=4.
    expect(segments[0]).toHaveAttribute('data-point1', '[4,0]');
    expect(segments[0]).toHaveAttribute('data-point2', '[4,20]');
    // The label reaches the plot as a Text node.
    expect(screen.getByTestId('text')).toHaveTextContent('N₀');
  });

  it('shows a legend by default when there are two or more functions', () => {
    render(
      <MathPlot
        type="curves"
        xRange={[0, 10]}
        functions={[
          { label: 'linear', fn: (x) => x },
          { label: 'squared', fn: (x) => x * x },
        ]}
      />,
    );

    const legend = screen.getByRole('list');
    expect(legend).toHaveTextContent('linear');
    expect(legend).toHaveTextContent('squared');
  });

  it('hides the legend for a single-function plot unless the author overrides', () => {
    render(
      <MathPlot type="curves" xRange={[0, 10]} functions={[{ label: 'f', fn: (x) => x }]} />,
    );

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('paints the title as a figcaption when provided', () => {
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
});
