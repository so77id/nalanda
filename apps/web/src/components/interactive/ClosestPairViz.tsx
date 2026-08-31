import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';

export interface Point {
  x: number;
  y: number;
}

export interface ClosestPair {
  a: Point;
  b: Point;
  distance: number;
  /** Indices of a and b in the sorted-by-x array. */
  aIndex: number;
  bIndex: number;
}

export interface CallFrame {
  lo: number;
  hi: number;
}

/**
 * One step of the D&C closest-pair trace. Every step carries the subset of the
 * sorted-by-x array that the current call is operating on, plus the info the
 * widget needs to paint the plane for that step.
 */
export interface ClosestPairStep {
  kind:
    | 'enter'
    | 'brute'
    | 'return-left'
    | 'return-right'
    | 'combine'
    | 'strip-init'
    | 'strip-sweep'
    | 'winner';
  path: CallFrame[];
  lo: number;
  hi: number;
  /** The x coordinate of the dividing line for this call (undefined for base). */
  midX?: number;
  /** The current best distance found so far in this call. */
  d?: number;
  /** The best pair found so far in this call. */
  bestPair?: ClosestPair;
  /** For brute and strip-sweep: the two indices of the pair being examined. */
  testingA?: number;
  testingB?: number;
  /** The euclidean distance of the pair being examined this step. */
  testDistance?: number;
  /** The strip's indices, for strip-init and strip-sweep. */
  strip?: number[];
  description: string;
  highlightLines: number[];
}

export interface ClosestPairTrace {
  steps: ClosestPairStep[];
  winner: ClosestPair;
  sortedPoints: Point[];
}

/**
 * The pseudocode shown in the widget. Line numbers are 1-based and match the
 * highlight-line targeting in `LINE`.
 *
 * ```
 *   1  Pair closestPair(Point[] P) {
 *   2      if (P.length <= 3) return bruteForce(P);
 *   3      int mid = P.length / 2;
 *   4      Pair leftBest  = closestPair(P[0..mid]);
 *   5      Pair rightBest = closestPair(P[mid..end]);
 *   6      double d = min(leftBest.d, rightBest.d);
 *   7      Point[] strip = pointsWithin(P, mid, d);
 *   8      return min(leftBest, rightBest, stripSweep(strip, d));
 *   9  }
 *  10
 *  11  Pair stripSweep(Point[] strip, double d) {
 *  12      strip = sortByY(strip);
 *  13      for (int i = 0; i < strip.length; i++) {
 *  14          for (int j = i + 1; j < min(i + 8, strip.length); j++) {
 *  15              double dist = euclidean(strip[i], strip[j]);
 *  16              if (dist < d) { d = dist; best = pair(i, j); }
 *  17          }
 *  18      }
 *  19      return best;
 *  20  }
 * ```
 */
const CODE = `Pair closestPair(Point[] P) {
    if (P.length <= 3) return bruteForce(P);
    int mid = P.length / 2;
    Pair leftBest  = closestPair(P[0..mid]);
    Pair rightBest = closestPair(P[mid..end]);
    double d = min(leftBest.d, rightBest.d);
    Point[] strip = pointsWithin(P, mid, d);
    return min(leftBest, rightBest, stripSweep(strip, d));
}

Pair stripSweep(Point[] strip, double d) {
    strip = sortByY(strip);
    for (int i = 0; i < strip.length; i++) {
        for (int j = i + 1; j < min(i + 8, strip.length); j++) {
            double dist = euclidean(strip[i], strip[j]);
            if (dist < d) { d = dist; best = pair(i, j); }
        }
    }
    return best;
}`;

const LINE = {
  BRUTE: 2,
  MID: 3,
  LEFT_CALL: 4,
  RIGHT_CALL: 5,
  COMBINE_D: 6,
  STRIP_INIT: 7,
  RETURN_MIN: 8,
  STRIP_SWEEP: 15,
} as const;

const MAX_STEPS = 300;
const BRUTE_THRESHOLD = 3;
const STRIP_SWEEP_WINDOW = 7;

function euclidean(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pure trace of the divide-and-conquer closest-pair algorithm. The input is
 * sorted internally by x; every trace step's `lo`/`hi` are indices into that
 * sorted array (exposed as `sortedPoints` in the result so the widget can
 * paint from the same ordering).
 */
export function tracesClosestPair(points: Point[]): ClosestPairTrace {
  const sorted = points.map((p) => ({ ...p })).sort((a, b) => a.x - b.x || a.y - b.y);
  const indexed = sorted.map((p, i) => ({ ...p, i }));
  const steps: ClosestPairStep[] = [];
  const path: CallFrame[] = [];

  function makePair(iA: number, iB: number): ClosestPair {
    const [lo, hi] = iA < iB ? [iA, iB] : [iB, iA];
    return {
      a: sorted[lo]!,
      b: sorted[hi]!,
      distance: euclidean(sorted[lo]!, sorted[hi]!),
      aIndex: lo,
      bIndex: hi,
    };
  }

  function recurse(lo: number, hi: number): ClosestPair {
    const frame: CallFrame = { lo, hi };
    path.push(frame);
    const snapshotPath = () => path.map((f) => ({ ...f }));
    const size = hi - lo + 1;

    if (size <= BRUTE_THRESHOLD) {
      // Base case: brute force. Emit an enter, then one 'brute' step per
      // pair, then the winner.
      steps.push({
        kind: 'enter',
        path: snapshotPath(),
        lo,
        hi,
        description: `Caso base: ${size} punto(s) en [${lo}..${hi}] — fuerza bruta.`,
        highlightLines: [LINE.BRUTE],
      });

      let best: ClosestPair | null = null;
      for (let i = lo; i <= hi; i += 1) {
        for (let j = i + 1; j <= hi; j += 1) {
          const pair = makePair(i, j);
          if (best === null || pair.distance < best.distance) best = pair;
          steps.push({
            kind: 'brute',
            path: snapshotPath(),
            lo,
            hi,
            testingA: i,
            testingB: j,
            testDistance: pair.distance,
            d: best.distance,
            bestPair: best,
            description: `Distancia(${i}, ${j}) = ${pair.distance.toFixed(2)} · mejor par hasta ahora [${best.aIndex}, ${best.bIndex}] d = ${best.distance.toFixed(2)}`,
            highlightLines: [LINE.BRUTE],
          });
        }
      }

      const winner = best!;
      steps.push({
        kind: 'winner',
        path: snapshotPath(),
        lo,
        hi,
        d: winner.distance,
        bestPair: winner,
        description: `Ganador del rango [${lo}..${hi}]: par (${winner.aIndex}, ${winner.bIndex}) d = ${winner.distance.toFixed(2)}`,
        highlightLines: [LINE.BRUTE],
      });

      path.pop();
      return winner;
    }

    const midIndex = lo + Math.floor(size / 2);
    // Dividing x is between P[midIndex-1].x and P[midIndex].x — use their
    // midpoint so the line sits visually between the two halves.
    const midX = (sorted[midIndex - 1]!.x + sorted[midIndex]!.x) / 2;
    steps.push({
      kind: 'enter',
      path: snapshotPath(),
      lo,
      hi,
      midX,
      description: `Entrar rango [${lo}..${hi}] con ${size} puntos · línea en x = ${midX.toFixed(2)}`,
      highlightLines: [LINE.MID],
    });

    const leftBest = recurse(lo, midIndex - 1);
    steps.push({
      kind: 'return-left',
      path: snapshotPath(),
      lo,
      hi,
      midX,
      d: leftBest.distance,
      bestPair: leftBest,
      description: `Vuelve la llamada izquierda con leftBest d = ${leftBest.distance.toFixed(2)} · par (${leftBest.aIndex}, ${leftBest.bIndex})`,
      highlightLines: [LINE.LEFT_CALL],
    });

    const rightBest = recurse(midIndex, hi);
    const combineBest = leftBest.distance <= rightBest.distance ? leftBest : rightBest;
    steps.push({
      kind: 'return-right',
      path: snapshotPath(),
      lo,
      hi,
      midX,
      d: rightBest.distance,
      bestPair: rightBest,
      description: `Vuelve la llamada derecha con rightBest d = ${rightBest.distance.toFixed(2)} · par (${rightBest.aIndex}, ${rightBest.bIndex})`,
      highlightLines: [LINE.RIGHT_CALL],
    });

    let d = combineBest.distance;
    let best: ClosestPair = combineBest;
    steps.push({
      kind: 'combine',
      path: snapshotPath(),
      lo,
      hi,
      midX,
      d,
      bestPair: best,
      description: `d = min(${leftBest.distance.toFixed(2)}, ${rightBest.distance.toFixed(2)}) = ${d.toFixed(2)} · par (${best.aIndex}, ${best.bIndex})`,
      highlightLines: [LINE.COMBINE_D],
    });

    // Strip: indices whose x is within d of midX.
    const strip: number[] = [];
    for (let k = lo; k <= hi; k += 1) {
      if (Math.abs(indexed[k]!.x - midX) < d) strip.push(k);
    }
    // Sort the strip by y so the 7-position sweep works.
    strip.sort((iA, iB) => indexed[iA]!.y - indexed[iB]!.y);

    steps.push({
      kind: 'strip-init',
      path: snapshotPath(),
      lo,
      hi,
      midX,
      d,
      bestPair: best,
      strip,
      description: `Franja de ancho 2·${d.toFixed(2)} centrada en x = ${midX.toFixed(2)}: ${strip.length} punto(s), ordenar por y.`,
      highlightLines: [LINE.STRIP_INIT],
    });

    // Sweep the strip: for each point, compare against the next 7.
    for (let i = 0; i < strip.length; i += 1) {
      for (let j = i + 1; j < Math.min(i + 1 + STRIP_SWEEP_WINDOW, strip.length); j += 1) {
        const pair = makePair(strip[i]!, strip[j]!);
        if (pair.distance < d) {
          d = pair.distance;
          best = pair;
        }
        steps.push({
          kind: 'strip-sweep',
          path: snapshotPath(),
          lo,
          hi,
          midX,
          d,
          bestPair: best,
          strip,
          testingA: strip[i]!,
          testingB: strip[j]!,
          testDistance: pair.distance,
          description: `Sweep franja: distancia(${strip[i]}, ${strip[j]}) = ${pair.distance.toFixed(2)} · mejor d = ${d.toFixed(2)}`,
          highlightLines: [LINE.STRIP_SWEEP],
        });
      }
    }

    steps.push({
      kind: 'winner',
      path: snapshotPath(),
      lo,
      hi,
      midX,
      d,
      bestPair: best,
      description: `Ganador del rango [${lo}..${hi}]: par (${best.aIndex}, ${best.bIndex}) d = ${d.toFixed(2)}`,
      highlightLines: [LINE.RETURN_MIN],
    });

    path.pop();
    return best;
  }

  const rootWinner = recurse(0, sorted.length - 1);
  return { steps, winner: rootWinner, sortedPoints: sorted };
}

// ── Widget ──────────────────────────────────────────────────────────────────

export interface ClosestPairVizProps {
  points?: Point[];
  title?: string;
  speed?: number;
  autoplay?: boolean;
}

export function ClosestPairViz({
  points,
  title,
  speed = 1,
  autoplay = false,
}: ClosestPairVizProps) {
  if (points === undefined || points.length < 2) {
    return (
      <AuthoringError component="ClosestPairViz">
        falta la prop <code>points</code> con al menos 2 puntos <code>{'{x, y}'}</code>.
      </AuthoringError>
    );
  }

  const trace = tracesClosestPair(points);
  if (trace.steps.length > MAX_STEPS) {
    return (
      <AuthoringError component="ClosestPairViz">
        el trace de {points.length} puntos es demasiado grande ({trace.steps.length}+ pasos, tope{' '}
        {MAX_STEPS}). Usa menos puntos — el punto pedagógico se ve bien con 8.
      </AuthoringError>
    );
  }

  return <Body trace={trace} title={title} speed={speed} autoplay={autoplay} />;
}

interface BodyProps {
  trace: ClosestPairTrace;
  title?: string;
  speed: number;
  autoplay: boolean;
}

function Body({ trace, title, speed, autoplay }: BodyProps) {
  const totalSteps = trace.steps.length;

  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);

  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(autoplay);
  }, [trace, autoplay]);

  useEffect(() => {
    if (!isPlaying) return;
    if (stepIndex >= totalSteps - 1) {
      setIsPlaying(false);
      return;
    }
    const delay = 700 / Math.max(0.25, speed);
    const timeout = window.setTimeout(() => setStepIndex((s) => s + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [isPlaying, stepIndex, speed, totalSteps]);

  const step = trace.steps[stepIndex]!;
  const isFinal = stepIndex === totalSteps - 1;

  const advance = useCallback(() => {
    setStepIndex((s) => Math.min(s + 1, totalSteps - 1));
  }, [totalSteps]);
  const rewind = useCallback(() => {
    setStepIndex((s) => Math.max(s - 1, 0));
  }, []);
  const reset = useCallback(() => {
    setStepIndex(0);
    setIsPlaying(false);
  }, []);
  const togglePlay = useCallback(() => {
    if (stepIndex >= totalSteps - 1) {
      setStepIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((p) => !p);
    }
  }, [stepIndex, totalSteps]);

  const heading = title ?? `Par más cercano D&C · ${trace.sortedPoints.length} puntos`;

  return (
    <figure
      data-widget="closest-pair-viz"
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          closest
        </span>
        <h4 className="m-0 text-sm font-medium text-ink">{heading}</h4>
      </header>

      <div className="border-b border-rule">
        <CodeStepper code={CODE} highlightLines={step.highlightLines} language="java" />
      </div>

      <div className="overflow-x-auto px-3 py-4">
        <Plane
          points={trace.sortedPoints}
          step={step}
          finalWinner={isFinal ? trace.winner : null}
        />
      </div>

      <Breadcrumb path={step.path} />

      <div className="border-t border-rule bg-sunk px-3 py-2 text-sm text-ink">
        <p className="m-0 font-mono text-xs">
          <span className="text-ink-faint">
            Paso {stepIndex + 1}/{totalSteps} ·{' '}
          </span>
          {step.description}
        </p>
        {isFinal ? (
          <p className="m-0 mt-1 font-mono text-xs">
            <span className="text-keep">✓ </span>
            <strong>
              {`Par más cercano: puntos (${trace.winner.aIndex}, ${trace.winner.bIndex}), distancia = ${trace.winner.distance.toFixed(2)}`}
            </strong>
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-sunk px-3 py-1.5">
        <ControlButton onClick={rewind} disabled={stepIndex === 0} label="Atrás">
          <SkipBack size={14} aria-hidden />
        </ControlButton>
        <ControlButton onClick={advance} disabled={stepIndex >= totalSteps - 1} label="Paso">
          <SkipForward size={14} aria-hidden />
        </ControlButton>
        <ControlButton onClick={togglePlay} label={isPlaying ? 'Pausa' : 'Play'}>
          {isPlaying ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        </ControlButton>
        <ControlButton onClick={reset} label="Reset">
          <RotateCcw size={14} aria-hidden />
        </ControlButton>
      </div>
    </figure>
  );
}

interface PlaneProps {
  points: Point[];
  step: ClosestPairStep;
  finalWinner: ClosestPair | null;
}

const PLANE_W = 480;
const PLANE_H = 260;
const PLANE_PAD = 28;

function Plane({ points, step, finalWinner }: PlaneProps) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = Math.max(1e-6, xMax - xMin);
  const ySpan = Math.max(1e-6, yMax - yMin);

  const px = (x: number) => PLANE_PAD + ((x - xMin) / xSpan) * (PLANE_W - 2 * PLANE_PAD);
  const py = (y: number) => PLANE_H - PLANE_PAD - ((y - yMin) / ySpan) * (PLANE_H - 2 * PLANE_PAD);

  const active = new Set<number>();
  for (let i = step.lo; i <= step.hi; i += 1) active.add(i);

  const stripSet = new Set(step.strip ?? []);

  const dividingX = step.midX !== undefined ? px(step.midX) : null;
  const stripLeftX =
    step.midX !== undefined && step.d !== undefined ? px(step.midX - step.d) : null;
  const stripRightX =
    step.midX !== undefined && step.d !== undefined ? px(step.midX + step.d) : null;

  return (
    <svg
      role="img"
      aria-label="Plano 2D con los puntos y la construcción D&C del paso actual"
      viewBox={`0 0 ${PLANE_W} ${PLANE_H}`}
      className="block w-full max-w-full"
      style={{ maxHeight: '260px' }}
    >
      {/* Strip band, drawn first so points paint over it. */}
      {stripLeftX !== null &&
      stripRightX !== null &&
      (step.kind === 'strip-init' || step.kind === 'strip-sweep') ? (
        <rect
          x={stripLeftX}
          y={PLANE_PAD - 6}
          width={stripRightX - stripLeftX}
          height={PLANE_H - 2 * PLANE_PAD + 12}
          className="fill-accent-soft"
          opacity={0.5}
        />
      ) : null}

      {/* Dividing line. */}
      {dividingX !== null ? (
        <line
          x1={dividingX}
          x2={dividingX}
          y1={PLANE_PAD - 6}
          y2={PLANE_H - PLANE_PAD + 6}
          className="stroke-accent-pop"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      ) : null}

      {/* Final winner pair — a bold connecting line drawn under everything else. */}
      {finalWinner !== null ? (
        <line
          x1={px(finalWinner.a.x)}
          y1={py(finalWinner.a.y)}
          x2={px(finalWinner.b.x)}
          y2={py(finalWinner.b.y)}
          className="stroke-keep"
          strokeWidth={3}
        />
      ) : null}

      {/* Current best pair for this call — a thinner line. */}
      {step.bestPair !== undefined && finalWinner === null ? (
        <line
          x1={px(step.bestPair.a.x)}
          y1={py(step.bestPair.a.y)}
          x2={px(step.bestPair.b.x)}
          y2={py(step.bestPair.b.y)}
          className="stroke-keep"
          strokeWidth={2}
          opacity={0.7}
        />
      ) : null}

      {/* Currently tested pair — dashed line + distance label. */}
      {step.testingA !== undefined && step.testingB !== undefined ? (
        <>
          <line
            x1={px(points[step.testingA]!.x)}
            y1={py(points[step.testingA]!.y)}
            x2={px(points[step.testingB]!.x)}
            y2={py(points[step.testingB]!.y)}
            className="stroke-flag"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
          {step.testDistance !== undefined ? (
            <text
              x={(px(points[step.testingA]!.x) + px(points[step.testingB]!.x)) / 2 + 4}
              y={(py(points[step.testingA]!.y) + py(points[step.testingB]!.y)) / 2 - 4}
              className="fill-flag font-mono"
              fontSize="10"
            >
              {step.testDistance.toFixed(2)}
            </text>
          ) : null}
        </>
      ) : null}

      {/* Points. */}
      {points.map((p, i) => {
        const inActive = active.has(i);
        const inStrip = stripSet.has(i);
        const isTesting = i === step.testingA || i === step.testingB;
        const fillClass = isTesting
          ? 'fill-flag'
          : inStrip
            ? 'fill-accent-pop'
            : inActive
              ? 'fill-accent'
              : 'fill-ink-faint';
        const opacity = inActive || inStrip ? 1 : 0.35;
        return (
          <g key={i} data-point={i} opacity={opacity}>
            <circle cx={px(p.x)} cy={py(p.y)} r={5} className={fillClass} />
            <text x={px(p.x) + 7} y={py(p.y) - 6} className="fill-ink-faint font-mono" fontSize="9">
              {i}
            </text>
          </g>
        );
      })}

      {/* Best-pair distance label (for winner steps). */}
      {step.bestPair !== undefined && (step.kind === 'winner' || finalWinner !== null) ? (
        <text
          x={(px(step.bestPair.a.x) + px(step.bestPair.b.x)) / 2 + 4}
          y={(py(step.bestPair.a.y) + py(step.bestPair.b.y)) / 2 - 4}
          className="fill-keep font-mono font-semibold"
          fontSize="11"
        >
          d = {step.bestPair.distance.toFixed(2)}
        </text>
      ) : null}
    </svg>
  );
}

interface BreadcrumbProps {
  path: CallFrame[];
}

function Breadcrumb({ path }: BreadcrumbProps) {
  return (
    <div
      data-call-depth={path.length}
      className="flex flex-wrap items-center gap-1 border-t border-rule bg-sunk px-3 py-1 font-mono text-3xs text-ink-faint"
    >
      <span>Pila:</span>
      {path.map((frame, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 ? <span aria-hidden>→</span> : null}
          <span className={i === path.length - 1 ? 'font-semibold text-accent' : ''}>
            [{frame.lo}..{frame.hi}]
          </span>
        </span>
      ))}
    </div>
  );
}

interface ControlButtonProps {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}

function ControlButton({ onClick, disabled, label, children }: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded border border-rule bg-surface px-2 py-1 text-xs text-ink hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {children}
      {label}
    </button>
  );
}
