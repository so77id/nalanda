import { ResponsiveLine } from '@nivo/line';

/**
 * Local shape of a Nivo Line series. `@nivo/line` no longer exports its
 * `Serie` type by name in this version; the shape is tiny (id + data
 * points) so we declare it locally instead of chasing the type export.
 */
interface NivoSeries {
  id: string;
  color?: string;
  data: { x: number; y: number }[];
}
import { useMemo } from 'react';

import { useEmbedded } from '../embedded';
import { useResolvedTheme } from '../../lib/useResolvedTheme';
import { AuthoringError } from '../AuthoringError';

/**
 * A curve to overlay on the plot.
 */
export interface MathPlotFunction {
  /** Legend label. */
  label: string;
  /** The function itself, as a JS callback. */
  fn: (x: number) => number;
  /** Named colour from the plot's palette. Defaults to a rotating pick. */
  color?: 'blue' | 'green' | 'red' | 'orange' | 'violet' | 'pink' | 'indigo' | 'yellow';
  /** Dashed stroke, useful for reference lines. Defaults to solid. */
  dashed?: boolean;
}

/**
 * Optional annotation drawn on top of the curves.
 */
export type MathPlotAnnotation =
  | {
      /** Vertical line at a fixed x, optionally with a label at the top. */
      type: 'verticalLine';
      x: number;
      label?: string;
    }
  | {
      /** Horizontal line at a fixed y, optionally with a label at the right. */
      type: 'horizontalLine';
      y: number;
      label?: string;
    };

export interface MathPlotProps {
  /**
   * Which flavour of plot to render. Only `"curves"` validates today; `"3d"`
   * and `"graph"` are reserved for future extensions (ADR-0046 §Alternatives).
   */
  type?: 'curves' | '3d' | 'graph';
  /** Optional title shown above the plot. */
  title?: string;
  /** The curves to plot. Required in `curves` mode. */
  functions?: MathPlotFunction[];
  /** Visible x range as [min, max]. Required. */
  xRange?: [number, number];
  /** Visible y range as [min, max]. `"auto"` (default) fits to the plotted values. */
  yRange?: [number, number] | 'auto';
  /**
   * Y-axis scale mode. `"linear"` (default), `"log"` (log10 on Y). `"loglog"`
   * reserved for future work.
   */
  scale?: 'linear' | 'log' | 'loglog';
  /** Whether to render the legend. Defaults to true when there are 2+ functions. */
  showLegend?: boolean;
  /** Vertical or horizontal reference lines. */
  annotations?: MathPlotAnnotation[];
  /** Sampling resolution for the plots — higher = smoother, slower. Defaults to 200. */
  samples?: number;
  /** Plot canvas height in pixels. Defaults to 320. */
  height?: number;
  /** X-axis label. Defaults to "N". */
  xLabel?: string;
  /** Y-axis label. Defaults to "costo". */
  yLabel?: string;
}

const COLOR_MAP = {
  blue: 'light-dark(#2563eb, #60a5fa)',
  green: 'light-dark(#059669, #34d399)',
  red: 'light-dark(#dc2626, #f87171)',
  orange: 'light-dark(#ea580c, #fb923c)',
  violet: 'light-dark(#7c3aed, #a78bfa)',
  pink: 'light-dark(#db2777, #f472b6)',
  indigo: 'light-dark(#4338ca, #818cf8)',
  yellow: 'light-dark(#d97706, #fbbf24)',
} as const;

const COLOR_ROTATION: (keyof typeof COLOR_MAP)[] = [
  'blue',
  'green',
  'red',
  'orange',
  'violet',
  'pink',
  'indigo',
  'yellow',
];

function pickColor(picked: MathPlotFunction['color'], index: number): string {
  const key = picked ?? COLOR_ROTATION[index % COLOR_ROTATION.length]!;
  return COLOR_MAP[key];
}

/**
 * A 2D math function plotter, built on Nivo Line — the same look Yerko's
 * matplotlib-style slides deliver, without carrying Python. The author writes
 * `y = f(x)`; the widget samples the function across `xRange`, hands the
 * points to Nivo, and lets Nivo do the axis / grid / legend / tooltip work.
 *
 * `scale="log"` transforms each function's output through `log10` before
 * sampling and marks the Y axis with the corresponding decade labels — the
 * knob that makes "comparar órdenes de crecimiento" a legible chart instead
 * of a wall of curves squashed against the x axis.
 *
 * The plot uses CSS custom properties + `light-dark(...)` so it reads right
 * in both themes without a runtime theme switch inside Nivo.
 */
export function MathPlot({
  type = 'curves',
  title,
  functions,
  xRange,
  yRange = 'auto',
  scale = 'linear',
  showLegend,
  annotations,
  samples = 200,
  height = 320,
  xLabel = 'N',
  yLabel = 'costo',
}: MathPlotProps) {
  const resolvedTheme = useResolvedTheme();
  const embedded = useEmbedded();
  const isLog = scale === 'log' || scale === 'loglog';

  // Build Nivo's `Serie[]`. Each series carries {x, y} points sampled evenly
  // across xRange. Log mode transforms y = log10(f(x)); points where f(x) is
  // non-positive or non-finite are skipped.
  const series = useMemo<NivoSeries[]>(() => {
    if (functions === undefined || xRange === undefined) return [];
    const [xMin, xMax] = xRange;
    const step = (xMax - xMin) / samples;
    return functions.map((f, i) => {
      const data: { x: number; y: number }[] = [];
      for (let k = 0; k <= samples; k++) {
        const x = xMin + k * step;
        let y: number;
        try {
          y = f.fn(x);
        } catch {
          continue;
        }
        if (!Number.isFinite(y)) continue;
        if (isLog) {
          if (y <= 0) continue;
          y = Math.log10(y);
        }
        data.push({ x, y });
      }
      return {
        id: f.label,
        color: pickColor(f.color, i),
        data,
      };
    });
  }, [functions, xRange, samples, isLog]);

  const yScale = useMemo(() => {
    if (yRange === 'auto') return { type: 'linear' as const, stacked: false };
    const [lo, hi] = yRange;
    if (isLog) {
      return {
        type: 'linear' as const,
        stacked: false,
        min: Math.log10(Math.max(1e-10, lo)),
        max: Math.log10(Math.max(1e-10, hi)),
      };
    }
    return { type: 'linear' as const, stacked: false, min: lo, max: hi };
  }, [yRange, isLog]);

  if (type !== 'curves') {
    return (
      <AuthoringError component="MathPlot">
        el tipo <code>{type}</code> aún no está implementado. Solo{' '}
        <code>type=&quot;curves&quot;</code> valida hoy; <code>3d</code> y <code>graph</code> son
        extensiones futuras (ADR-0046).
      </AuthoringError>
    );
  }

  if (functions === undefined || functions.length === 0) {
    return (
      <AuthoringError component="MathPlot">
        falta la prop <code>functions</code>: una lista con al menos una entrada{' '}
        <code>{'{ label, fn }'}</code>.
      </AuthoringError>
    );
  }

  if (xRange === undefined) {
    return (
      <AuthoringError component="MathPlot">
        falta la prop <code>xRange</code>: <code>[min, max]</code>.
      </AuthoringError>
    );
  }

  const legendVisible = showLegend ?? functions.length >= 2;
  const colors = series.map((s) => s.color ?? '#000');

  // Y-axis tick formatter for log mode: renders integer decades as 1, 10, 100...
  const formatLogTick = (value: number) => {
    if (!Number.isInteger(value)) return '';
    if (value === 0) return '1';
    if (value === 1) return '10';
    if (value === 2) return '100';
    if (value === 3) return '1 000';
    if (value === 4) return '10 000';
    if (value === 5) return '100 000';
    if (value === 6) return '1 000 000';
    return `10^${value}`;
  };

  // Reference-line markers as Nivo layers. Nivo has no first-class annotation
  // API, but its layers array lets us drop a small SVG on top of the plot.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const annotationLayer = ({ xScale, yScale: nivoYScale, innerHeight, innerWidth }: any) => (
    <g pointerEvents="none">
      {annotations?.map((a, i) => {
        if (a.type === 'verticalLine') {
          const x = xScale(a.x);
          return (
            <g key={`v-${i}`}>
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={innerHeight}
                stroke="currentColor"
                strokeDasharray="4 3"
                strokeWidth={1}
                opacity={0.7}
              />
              {a.label !== undefined && (
                <text x={x + 4} y={12} fontSize={11} fill="currentColor">
                  {a.label}
                </text>
              )}
            </g>
          );
        }
        const yVal = isLog ? Math.log10(Math.max(1e-10, a.y)) : a.y;
        const y = nivoYScale(yVal);
        return (
          <g key={`h-${i}`}>
            <line
              x1={0}
              x2={innerWidth}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeDasharray="4 3"
              strokeWidth={1}
              opacity={0.7}
            />
            {a.label !== undefined && (
              <text x={innerWidth - 4} y={y - 4} fontSize={11} fill="currentColor" textAnchor="end">
                {a.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );

  return (
    <figure
      className={
        embedded
          ? 'not-prose flex flex-col bg-surface'
          : 'not-prose my-6 flex flex-col rounded-lg border border-rule bg-surface'
      }
      data-mathplot-type={type}
      data-mathplot-scale={scale}
      data-theme={resolvedTheme}
    >
      {embedded ? null : (
        <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
          <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-accent">
            {isLog ? 'log' : 'curvas'}
          </span>
          {title !== undefined && <span className="text-sm font-medium text-ink">{title}</span>}
        </header>
      )}
      <div style={{ height: `${height}px` }} className="text-ink">
        <ResponsiveLine
          data={series}
          colors={colors}
          margin={{ top: 20, right: legendVisible ? 130 : 30, bottom: 50, left: 60 }}
          xScale={{ type: 'linear', min: xRange[0], max: xRange[1] }}
          yScale={yScale}
          axisTop={null}
          axisRight={null}
          axisBottom={{
            legend: xLabel,
            legendOffset: 36,
            legendPosition: 'middle',
            tickSize: 4,
            tickPadding: 4,
          }}
          axisLeft={{
            legend: yLabel,
            legendOffset: -50,
            legendPosition: 'middle',
            tickSize: 4,
            tickPadding: 4,
            format: isLog ? formatLogTick : undefined,
          }}
          enablePoints={false}
          enableGridX={false}
          enableGridY={true}
          curve="linear"
          isInteractive={true}
          useMesh={true}
          enableSlices={false}
          layers={[
            'grid',
            'markers',
            'axes',
            'areas',
            'crosshair',
            'lines',
            annotationLayer,
            'points',
            'slices',
            'mesh',
            'legends',
          ]}
          legends={
            legendVisible
              ? [
                  {
                    anchor: 'right',
                    direction: 'column',
                    justify: false,
                    translateX: 110,
                    translateY: 0,
                    itemWidth: 100,
                    itemHeight: 20,
                    itemsSpacing: 4,
                    symbolSize: 12,
                    symbolShape: 'square',
                  },
                ]
              : []
          }
          theme={{
            background: 'transparent',
            text: { fill: 'var(--nl-mathplot-fg, currentColor)', fontSize: 12 },
            axis: {
              domain: { line: { stroke: 'var(--nl-mathplot-axis, currentColor)', strokeWidth: 1 } },
              ticks: {
                line: { stroke: 'var(--nl-mathplot-axis, currentColor)', strokeWidth: 1 },
                text: { fill: 'var(--nl-mathplot-fg, currentColor)', fontSize: 11 },
              },
              legend: { text: { fill: 'var(--nl-mathplot-fg, currentColor)', fontSize: 12 } },
            },
            grid: { line: { stroke: 'var(--nl-mathplot-grid, currentColor)', strokeOpacity: 0.15 } },
            legends: { text: { fill: 'var(--nl-mathplot-fg, currentColor)', fontSize: 11 } },
            tooltip: {
              container: {
                background: 'var(--nl-surface, white)',
                color: 'var(--nl-mathplot-fg, black)',
                fontSize: 11,
              },
            },
          }}
        />
      </div>
      {/*
       * Theme-aware tokens for Nivo. `light-dark()` lets the browser pick per
       * active theme; declaring both at the container makes the plot read
       * right in system, light, and dark. Grid gets a low-opacity ink for the
       * matplotlib-style thin lines.
       */}
      <style>{`
        [data-mathplot-type] {
          --nl-mathplot-fg: light-dark(rgb(17 24 39), rgb(226 232 240));
          --nl-mathplot-axis: light-dark(rgb(71 85 105), rgb(148 163 184));
          --nl-mathplot-grid: light-dark(rgb(148 163 184), rgb(100 116 139));
        }
      `}</style>
    </figure>
  );
}
