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
  color?: 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'pink' | 'indigo' | 'yellow';
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
  /** Visible y range as [min, max]. `"auto"` (default) fits to the plotted values. */
  yRange?: [number, number] | 'auto';
  /**
   * Scale mode. Only `"linear"` validates today; `"log"` and `"loglog"` are
   * documented in ADR-0046 as future extensions and fall back to linear with
   * a console note (no user-visible error — the plot still renders).
   */
  scale?: 'linear' | 'log' | 'loglog';
  /** Whether to render the legend. Defaults to true when there are 2+ functions. */
  showLegend?: boolean;
  /** Vertical or horizontal reference lines, useful for O/Ω/Θ bounds. */
  annotations?: MathPlotAnnotation[];
  /** Sampling resolution for the plots — higher = smoother, slower. Defaults to 200. */
  samples?: number;
}

const COLOR_ROTATION = [
  Theme.blue,
  Theme.green,
  Theme.red,
  Theme.orange,
  Theme.purple,
  Theme.pink,
  Theme.indigo,
  Theme.yellow,
] as const;

function colorOf(picked: MathPlotFunction['color'], index: number): string {
  if (picked !== undefined) return Theme[picked];
  return COLOR_ROTATION[index % COLOR_ROTATION.length]!;
}

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
 * The library is Mafs (~30 KB, React-first, KaTeX for labels — same
 * mathematics renderer the site already uses via other paths). Lazy-loaded
 * behind Suspense so it does not enter the entry chunk (see
 * `lazyMathPlot.tsx`).
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
}: MathPlotProps) {
  const resolvedTheme = useResolvedTheme();

  // Auto y-range: sample every function across xRange and derive [minY, maxY].
  // Called unconditionally (hooks discipline) — if the render bails out via an
  // early authoring-error return, the value is computed and discarded, which
  // is cheap when `functions` is empty or `xRange` is missing.
  const computedYRange = useMemo<[number, number]>(() => {
    if (yRange !== 'auto') return yRange;
    if (xRange === undefined || functions === undefined || functions.length === 0) {
      return [-10, 10];
    }
    const [xMin, xMax] = xRange;
    const step = (xMax - xMin) / samples;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const { fn } of functions) {
      for (let i = 0; i <= samples; i++) {
        const x = xMin + i * step;
        try {
          const y = fn(x);
          if (Number.isFinite(y)) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        } catch {
          // Ignore samples where fn throws — sqrt(-1), 1/0, etc.
        }
      }
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return [-10, 10];
    const pad = (maxY - minY) * 0.05 || 1;
    return [Math.min(0, minY - pad), maxY + pad];
  }, [functions, xRange, yRange, samples]);

  if (type !== 'curves') {
    return (
      <AuthoringError component="MathPlot">
        el tipo <code>{type}</code> aún no está implementado. Solo{' '}
        <code>type=&quot;curves&quot;</code> valida hoy; <code>3d</code> y <code>graph</code>{' '}
        son extensiones futuras (ADR-0046).
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

  return (
    <figure
      className="not-prose my-6 flex flex-col rounded-lg border border-rule bg-surface p-3"
      data-mathplot-type={type}
      data-mathplot-scale={scale}
    >
      {title !== undefined && (
        <figcaption className="mb-2 text-sm font-medium text-ink">{title}</figcaption>
      )}
      <div
        className="w-full"
        // Mafs paints against its own CSS variables; the container inherits the
        // site's theme via useResolvedTheme so the surrounding chrome matches.
        data-theme={resolvedTheme}
      >
        <Mafs
          viewBox={{ x: xRange, y: computedYRange }}
          preserveAspectRatio={false}
          zoom={false}
        >
          <Coordinates.Cartesian />
          {functions.map((f, i) => (
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
            return (
              <Line.Segment
                key={`h-${i}`}
                point1={[xRange[0], annotation.y]}
                point2={[xRange[1], annotation.y]}
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
            return (
              <Text
                key={`hl-${i}`}
                x={xRange[1] * 0.95}
                y={annotation.y}
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
        <ul className="mt-2 flex flex-wrap gap-3 text-xs text-ink-soft">
          {functions.map((f, i) => (
            <li key={f.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-4"
                style={{ backgroundColor: colorOf(f.color, i) }}
              />
              <span className="font-mono">{f.label}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
