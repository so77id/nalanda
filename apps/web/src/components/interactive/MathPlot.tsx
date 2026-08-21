import { Coordinates, Line, Mafs, Plot, Text, Theme } from 'mafs';
import { useMemo } from 'react';

import { useResolvedTheme } from '../../lib/useResolvedTheme';
import { AuthoringError } from '../AuthoringError';

import 'mafs/core.css';

/**
 * A curve to overlay on the plot.
 */
export interface MathPlotFunction {
  /** Legend label, LaTeX-friendly (Mafs renders labels via KaTeX). */
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
   * and `"graph"` are reserved for future extensions (ADR-0046 §Alternatives)
   * and reject the render with a clear authoring error until they land.
   */
  type?: 'curves' | '3d' | 'graph';
  /** Optional title shown above the plot. */
  title?: string;
  /** The curves to plot. Required in `curves` mode. */
  functions?: MathPlotFunction[];
  /** Visible x range as [min, max]. Required. */
  xRange?: [number, number];
  /**
   * Visible y range as [min, max]. `"auto"` (default) fits to the plotted
   * values. In `log` mode the range is stated in ORIGINAL units (e.g.
   * `[1, 10000]`) — the widget converts to log-space internally.
   */
  yRange?: [number, number] | 'auto';
  /**
   * Y-axis scale mode. `"linear"` (default) plots y directly. `"log"` plots
   * `log10(y)` so orders of growth that differ by many orders of magnitude
   * (1, lg n, n, n log n, n²) become legible on the same plot.
   * `"loglog"` reserved for future extension (ADR-0046 §6).
   */
  scale?: 'linear' | 'log' | 'loglog';
  /** Whether to render the legend. Defaults to true when there are 2+ functions. */
  showLegend?: boolean;
  /** Vertical or horizontal reference lines, useful for O/Ω/Θ bounds. */
  annotations?: MathPlotAnnotation[];
  /** Sampling resolution for the plots — higher = smoother, slower. Defaults to 200. */
  samples?: number;
  /**
   * Height of the plotting canvas in pixels. Defaults to 320. Set larger for
   * a slide that lives on its own, smaller for inline figures.
   */
  height?: number;
}

const COLOR_ROTATION = [
  Theme.blue,
  Theme.green,
  Theme.red,
  Theme.orange,
  Theme.violet,
  Theme.pink,
  Theme.indigo,
  Theme.yellow,
] as const;

function colorOf(picked: MathPlotFunction['color'], index: number): string {
  if (picked !== undefined) return Theme[picked];
  return COLOR_ROTATION[index % COLOR_ROTATION.length]!;
}

/**
 * CSS variable overrides for Mafs so both themes read correct. `light-dark(...)`
 * lets the browser pick per active theme; declaring it unconditionally (not
 * behind an if branch) is what fixed the "dark rectangle on a light page" bug
 * flagged in the UI review.
 */
const MAFS_THEME_STYLE: React.CSSProperties = {
  ['--mafs-bg' as string]: 'transparent',
  ['--mafs-fg' as string]:
    'light-dark(rgb(17 24 39), rgb(226 232 240))',
  ['--mafs-line-color' as string]:
    'light-dark(rgb(203 213 225), rgb(51 65 85))',
  ['--grid-line-subdivision-color' as string]:
    'light-dark(rgb(241 245 249), rgb(30 41 59))',
  ['--mafs-origin-color' as string]:
    'light-dark(rgb(100 116 139), rgb(148 163 184))',
};

/**
 * A 2D math function plotter (ADR-0046), built on top of Mafs.
 *
 * The author declares one or more functions `y = f(x)` and the widget paints
 * them on a shared coordinate system with an optional legend, optional
 * reference lines (vertical / horizontal), and a hover tooltip on each curve
 * (Mafs's default interaction).
 *
 * Type is a prop rather than a component name because the widget is designed
 * to grow — `type="3d"` and `type="graph"` are the two extensions the class
 * anticipates for future acts (3D surfaces and node-edge graphs). Today only
 * `type="curves"` is implemented; the others fall through to an authoring
 * error so the surface is honest about what it does.
 *
 * `scale="log"` transforms each function's output through `log10` before
 * handing it to Mafs — the plot is drawn in log-space and the Y axis's tick
 * labels are re-formatted to show the original decade values (1, 10, 100, …).
 * This is what makes "comparar órdenes de crecimiento" (1, lg n, n, n²) a
 * single legible chart instead of three curves squashed against the x axis.
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
}: MathPlotProps) {
  const resolvedTheme = useResolvedTheme();
  const isLog = scale === 'log' || scale === 'loglog';

  // Transform functions into log space when needed. `Math.log10(0)` is
  // -Infinity — clamp to a tiny positive value so a constant-1 curve does not
  // vanish and a curve that dips to zero degrades gracefully.
  const displayFns = useMemo(() => {
    if (!isLog) return functions;
    return functions?.map(
      (f) =>
        ({
          ...f,
          fn: (x: number) => {
            const y = f.fn(x);
            if (!Number.isFinite(y) || y <= 0) return Number.NaN;
            return Math.log10(y);
          },
        }) as MathPlotFunction,
    );
  }, [functions, isLog]);

  // Auto y-range: sample every function across xRange and derive [minY, maxY].
  // In log mode the sampling happens on the display (log-space) functions.
  const computedYRange = useMemo<[number, number]>(() => {
    if (yRange !== 'auto') {
      if (isLog) {
        const [lo, hi] = yRange;
        return [Math.log10(Math.max(1e-10, lo)), Math.log10(Math.max(1e-10, hi))];
      }
      return yRange;
    }
    if (xRange === undefined || displayFns === undefined || displayFns.length === 0) {
      return [-10, 10];
    }
    const [xMin, xMax] = xRange;
    const step = (xMax - xMin) / samples;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const { fn } of displayFns) {
      for (let i = 0; i <= samples; i++) {
        const x = xMin + i * step;
        try {
          const y = fn(x);
          if (Number.isFinite(y)) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        } catch {
          // Ignore samples where fn throws.
        }
      }
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return [-10, 10];
    const pad = (maxY - minY) * 0.05 || 1;
    if (isLog) {
      // Snap to whole decades so the tick labels come out as 1, 10, 100...
      return [Math.floor(minY - pad * 0.2), Math.ceil(maxY + pad * 0.2)];
    }
    return [Math.min(0, minY - pad), maxY + pad];
  }, [displayFns, xRange, yRange, samples, isLog]);

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

  // Y-axis label formatter. On log scale each integer step is a decade, so
  // the label is 10^k rendered plain-text (no LaTeX so Mafs's KaTeX renderer
  // does not need to run for something as short as "10", "100").
  const yLabelMaker = isLog
    ? (n: number) => {
        if (!Number.isInteger(n)) return '';
        if (n === 0) return '1';
        if (n === 1) return '10';
        if (n === -1) return '0.1';
        return `10^${n}`;
      }
    : undefined;

  // Decade grid lines on Y in log mode. `lines: 1` means one line per unit
  // (= one line per decade in log-space).
  const yAxisConfig = isLog
    ? {
        axis: true as const,
        lines: 1,
        labels: yLabelMaker as (n: number) => string,
      }
    : undefined;

  return (
    <figure
      className="not-prose my-6 flex flex-col rounded-lg border border-rule bg-surface"
      data-mathplot-type={type}
      data-mathplot-scale={scale}
    >
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-accent">
          {isLog ? 'log' : 'curvas'}
        </span>
        {title !== undefined && <span className="text-sm font-medium text-ink">{title}</span>}
      </header>
      <div
        className="w-full p-3"
        data-theme={resolvedTheme}
        style={MAFS_THEME_STYLE}
      >
        <Mafs
          viewBox={{ x: xRange, y: computedYRange }}
          preserveAspectRatio={false}
          zoom={false}
          height={height}
        >
          {yAxisConfig !== undefined ? (
            <Coordinates.Cartesian yAxis={yAxisConfig} subdivisions={false} />
          ) : (
            <Coordinates.Cartesian />
          )}
          {displayFns?.map((f, i) => (
            <Plot.OfX
              key={f.label}
              y={f.fn}
              color={colorOf(f.color, i)}
              style={f.dashed === true ? 'dashed' : 'solid'}
            />
          ))}
          {annotations?.map((annotation, i) => {
            if (annotation.type === 'verticalLine') {
              return (
                <Line.Segment
                  key={`v-${i}`}
                  point1={[annotation.x, computedYRange[0]]}
                  point2={[annotation.x, computedYRange[1]]}
                  color={Theme.foreground}
                  style="dashed"
                  weight={1}
                />
              );
            }
            // Horizontal reference: if we are in log mode the author declares
            // the y in original units, transform for the plot.
            const y = isLog ? Math.log10(Math.max(1e-10, annotation.y)) : annotation.y;
            return (
              <Line.Segment
                key={`h-${i}`}
                point1={[xRange[0], y]}
                point2={[xRange[1], y]}
                color={Theme.foreground}
                style="dashed"
                weight={1}
              />
            );
          })}
          {annotations?.map((annotation, i) => {
            if (annotation.label === undefined) return null;
            if (annotation.type === 'verticalLine') {
              return (
                <Text
                  key={`vl-${i}`}
                  x={annotation.x}
                  y={computedYRange[1] * 0.95}
                  attach="e"
                  color={Theme.foreground}
                >
                  {annotation.label}
                </Text>
              );
            }
            const y = isLog ? Math.log10(Math.max(1e-10, annotation.y)) : annotation.y;
            return (
              <Text
                key={`hl-${i}`}
                x={xRange[1] * 0.95}
                y={y}
                attach="n"
                color={Theme.foreground}
              >
                {annotation.label}
              </Text>
            );
          })}
        </Mafs>
      </div>
      {legendVisible && (
        <ul className="flex flex-wrap gap-3 border-t border-rule bg-sunk px-3 py-2 font-mono text-3xs uppercase tracking-wide text-ink-faint">
          {functions.map((f, i) => (
            <li key={f.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-4"
                style={{ backgroundColor: colorOf(f.color, i) }}
              />
              <span>{f.label}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
