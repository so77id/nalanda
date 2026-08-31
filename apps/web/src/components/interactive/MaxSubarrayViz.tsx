import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';

export interface SubarrayResult {
  sum: number;
  from: number;
  to: number;
}

export interface CallFrame {
  lo: number;
  hi: number;
}

/**
 * One step of the D&C trace. A discriminated union by `kind`; the widget maps
 * each kind to a paint and a narration. Every step carries the call path so
 * the breadcrumb below the array can show depth.
 */
export interface MaxSubarrayStep {
  kind:
    | 'enter'
    | 'base'
    | 'return-left'
    | 'return-right'
    | 'cross-init'
    | 'cross-left-scan'
    | 'cross-right-scan'
    | 'cross-combine'
    | 'winner';
  path: CallFrame[];
  lo: number;
  hi: number;
  /** Non-null on internal-call steps (enter, cross-*, return-*, winner). */
  mid: number | null;
  /** For base steps only. */
  baseIndex?: number;
  baseValue?: number;
  /** For cross-left-scan and cross-right-scan: the cell currently examined. */
  scanIndex?: number;
  /** For scan steps: the running sum built by the scan. */
  currentSum?: number;
  /** The best prefix/suffix found so far during the cross. */
  leftBest?: SubarrayResult;
  rightBest?: SubarrayResult;
  /** For return-left / return-right / cross-combine / winner. */
  leftMax?: SubarrayResult;
  rightMax?: SubarrayResult;
  crossMax?: SubarrayResult;
  winner?: SubarrayResult;
  description: string;
  highlightLines: number[];
}

export interface MaxSubarrayTrace {
  steps: MaxSubarrayStep[];
  winner: SubarrayResult;
}

/**
 * Pseudocode the widget shows and traces against. Line numbers are 1-based and
 * match the highlight-line targeting in `LINE`.
 *
 * ```
 *   1  int maxSubarray(int[] a, int lo, int hi) {
 *   2      if (lo == hi) return a[lo];
 *   3      int mid = (lo + hi) / 2;
 *   4      int leftMax  = maxSubarray(a, lo, mid);
 *   5      int rightMax = maxSubarray(a, mid + 1, hi);
 *   6      int crossMax = maxCross(a, lo, mid, hi);
 *   7      return max(leftMax, rightMax, crossMax);
 *   8  }
 *   9
 *  10  int maxCross(int[] a, int lo, int mid, int hi) {
 *  11      int leftBest = Integer.MIN_VALUE, sum = 0;
 *  12      for (int i = mid; i >= lo; i--) {
 *  13          sum += a[i]; if (sum > leftBest) leftBest = sum;
 *  14      }
 *  15      int rightBest = Integer.MIN_VALUE; sum = 0;
 *  16      for (int j = mid + 1; j <= hi; j++) {
 *  17          sum += a[j]; if (sum > rightBest) rightBest = sum;
 *  18      }
 *  19      return leftBest + rightBest;
 *  20  }
 * ```
 */
const CODE = `int maxSubarray(int[] a, int lo, int hi) {
    if (lo == hi) return a[lo];
    int mid = (lo + hi) / 2;
    int leftMax  = maxSubarray(a, lo, mid);
    int rightMax = maxSubarray(a, mid + 1, hi);
    int crossMax = maxCross(a, lo, mid, hi);
    return max(leftMax, rightMax, crossMax);
}

int maxCross(int[] a, int lo, int mid, int hi) {
    int leftBest = Integer.MIN_VALUE, sum = 0;
    for (int i = mid; i >= lo; i--) {
        sum += a[i]; if (sum > leftBest) leftBest = sum;
    }
    int rightBest = Integer.MIN_VALUE; sum = 0;
    for (int j = mid + 1; j <= hi; j++) {
        sum += a[j]; if (sum > rightBest) rightBest = sum;
    }
    return leftBest + rightBest;
}`;

const LINE = {
  BASE: 2,
  MID: 3,
  LEFT_CALL: 4,
  RIGHT_CALL: 5,
  CROSS_CALL: 6,
  WINNER: 7,
  LEFT_SCAN: 13,
  RIGHT_SCAN: 17,
  CROSS_RETURN: 19,
} as const;

const MAX_STEPS = 300;

/**
 * Pure recursive trace of the divide-and-conquer max-subarray algorithm.
 * Emits one step per meaningful moment: entering a call, hitting a base case,
 * returning from the left / right recursive call, initialising the cross
 * scan, each position of the cross scan, combining the cross halves,
 * declaring the winner of the current call. The `path` field on every step
 * names the stack of ranges from the root — the widget's breadcrumb reads
 * it.
 */
export function tracesMaxSubarrayDivide(values: number[]): MaxSubarrayTrace {
  const steps: MaxSubarrayStep[] = [];
  const path: CallFrame[] = [];

  function recurse(lo: number, hi: number): SubarrayResult {
    const frame: CallFrame = { lo, hi };
    path.push(frame);
    const snapshotPath = () => path.map((f) => ({ ...f }));

    if (lo === hi) {
      const result: SubarrayResult = { sum: values[lo]!, from: lo, to: lo };
      steps.push({
        kind: 'base',
        path: snapshotPath(),
        lo,
        hi,
        mid: null,
        baseIndex: lo,
        baseValue: values[lo]!,
        description: `Caso base: a[${lo}] = ${values[lo]!}`,
        highlightLines: [LINE.BASE],
      });
      path.pop();
      return result;
    }

    const mid = Math.floor((lo + hi) / 2);
    steps.push({
      kind: 'enter',
      path: snapshotPath(),
      lo,
      hi,
      mid,
      description: `Entrar rango [${lo}..${hi}] · mid = ${mid} · dividir en [${lo}..${mid}] y [${mid + 1}..${hi}]`,
      highlightLines: [LINE.MID],
    });

    const leftMax = recurse(lo, mid);
    steps.push({
      kind: 'return-left',
      path: snapshotPath(),
      lo,
      hi,
      mid,
      leftMax,
      description: `Vuelve la llamada izquierda con leftMax = [${leftMax.from}..${leftMax.to}] suma ${leftMax.sum}`,
      highlightLines: [LINE.LEFT_CALL],
    });

    const rightMax = recurse(mid + 1, hi);
    steps.push({
      kind: 'return-right',
      path: snapshotPath(),
      lo,
      hi,
      mid,
      leftMax,
      rightMax,
      description: `Vuelve la llamada derecha con rightMax = [${rightMax.from}..${rightMax.to}] suma ${rightMax.sum}`,
      highlightLines: [LINE.RIGHT_CALL],
    });

    steps.push({
      kind: 'cross-init',
      path: snapshotPath(),
      lo,
      hi,
      mid,
      leftMax,
      rightMax,
      description: `Barrido cruzado desde mid = ${mid}: buscar el mejor sufijo hacia la izquierda y el mejor prefijo hacia la derecha`,
      highlightLines: [LINE.CROSS_CALL],
    });

    // Left scan: from mid down to lo.
    let currentSum = 0;
    let leftBest: SubarrayResult = { sum: -Infinity, from: mid, to: mid };
    for (let i = mid; i >= lo; i -= 1) {
      currentSum += values[i]!;
      if (currentSum > leftBest.sum) leftBest = { sum: currentSum, from: i, to: mid };
      steps.push({
        kind: 'cross-left-scan',
        path: snapshotPath(),
        lo,
        hi,
        mid,
        scanIndex: i,
        currentSum,
        leftBest,
        description: `Sufijo desde mid: suma acumulada = ${currentSum} · mejor sufijo hasta ahora [${leftBest.from}..${leftBest.to}] suma ${leftBest.sum}`,
        highlightLines: [LINE.LEFT_SCAN],
      });
    }

    // Right scan: from mid+1 up to hi.
    currentSum = 0;
    let rightBest: SubarrayResult = { sum: -Infinity, from: mid + 1, to: mid + 1 };
    for (let j = mid + 1; j <= hi; j += 1) {
      currentSum += values[j]!;
      if (currentSum > rightBest.sum) rightBest = { sum: currentSum, from: mid + 1, to: j };
      steps.push({
        kind: 'cross-right-scan',
        path: snapshotPath(),
        lo,
        hi,
        mid,
        scanIndex: j,
        currentSum,
        leftBest,
        rightBest,
        description: `Prefijo desde mid+1: suma acumulada = ${currentSum} · mejor prefijo hasta ahora [${rightBest.from}..${rightBest.to}] suma ${rightBest.sum}`,
        highlightLines: [LINE.RIGHT_SCAN],
      });
    }

    const crossMax: SubarrayResult = {
      sum: leftBest.sum + rightBest.sum,
      from: leftBest.from,
      to: rightBest.to,
    };
    steps.push({
      kind: 'cross-combine',
      path: snapshotPath(),
      lo,
      hi,
      mid,
      leftMax,
      rightMax,
      crossMax,
      leftBest,
      rightBest,
      description: `Cruce combinado: [${crossMax.from}..${crossMax.to}] suma ${crossMax.sum} = ${leftBest.sum} + ${rightBest.sum}`,
      highlightLines: [LINE.CROSS_RETURN],
    });

    const winner = pickWinner(leftMax, rightMax, crossMax);
    steps.push({
      kind: 'winner',
      path: snapshotPath(),
      lo,
      hi,
      mid,
      leftMax,
      rightMax,
      crossMax,
      winner,
      description: `Ganador del rango [${lo}..${hi}]: [${winner.from}..${winner.to}] suma ${winner.sum}`,
      highlightLines: [LINE.WINNER],
    });

    path.pop();
    return winner;
  }

  const rootWinner = recurse(0, values.length - 1);
  return { steps, winner: rootWinner };
}

function pickWinner(a: SubarrayResult, b: SubarrayResult, c: SubarrayResult): SubarrayResult {
  let best = a;
  if (b.sum > best.sum) best = b;
  if (c.sum > best.sum) best = c;
  return best;
}

// ── Widget ──────────────────────────────────────────────────────────────────

export interface MaxSubarrayVizProps {
  values?: number[];
  title?: string;
  speed?: number;
  autoplay?: boolean;
}

/**
 * The D&C max-subarray visualiser (ADR-0060) — code on top, array below with
 * the current call frame highlighted and the cross-scan cursor visible per
 * step, breadcrumb showing depth, narration explaining what the current step
 * decided, controls at the foot. Traces the FULL recursion — the reader sees
 * every enter/return/cross-scan/winner in order.
 */
export function MaxSubarrayViz({
  values,
  title,
  speed = 1,
  autoplay = false,
}: MaxSubarrayVizProps) {
  if (values === undefined || values.length < 1) {
    return (
      <AuthoringError component="MaxSubarrayViz">
        falta la prop <code>values</code> (arreglo de enteros no vacío).
      </AuthoringError>
    );
  }

  if (!values.every((v) => Number.isInteger(v))) {
    return (
      <AuthoringError component="MaxSubarrayViz">
        <code>values</code> tiene que estar compuesto solo por enteros.
      </AuthoringError>
    );
  }

  const trace = tracesMaxSubarrayDivide(values);
  if (trace.steps.length > MAX_STEPS) {
    return (
      <AuthoringError component="MaxSubarrayViz">
        el trace del arreglo de {values.length} elementos es demasiado grande ({trace.steps.length}+
        pasos, tope {MAX_STEPS}). Usa un arreglo menor — el punto pedagógico se ve bien con 8
        elementos.
      </AuthoringError>
    );
  }

  return <Body trace={trace} title={title} speed={speed} autoplay={autoplay} values={values} />;
}

interface BodyProps {
  values: number[];
  trace: MaxSubarrayTrace;
  title?: string;
  speed: number;
  autoplay: boolean;
}

function Body({ values, trace, title, speed, autoplay }: BodyProps) {
  const totalSteps = trace.steps.length;

  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);

  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(autoplay);
  }, [values, autoplay]);

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

  const heading = title ?? `Max-subarray D&C · arreglo de ${values.length}`;

  return (
    <figure
      data-widget="max-subarray-viz"
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          max-sub
        </span>
        <h4 className="m-0 text-sm font-medium text-ink">{heading}</h4>
      </header>

      <div className="border-b border-rule">
        <CodeStepper code={CODE} highlightLines={step.highlightLines} language="java" />
      </div>

      <div className="overflow-x-auto px-3 py-4">
        <ArrayVisual values={values} step={step} finalWinner={isFinal ? trace.winner : null} />
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
              {`Mejor sub-arreglo: [${trace.winner.from}..${trace.winner.to}], suma = ${trace.winner.sum}`}
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

interface ArrayVisualProps {
  values: number[];
  step: MaxSubarrayStep;
  finalWinner: SubarrayResult | null;
}

function ArrayVisual({ values, step, finalWinner }: ArrayVisualProps) {
  return (
    <div className="min-w-fit font-mono text-sm">
      <div className="flex items-end">
        {values.map((v, i) => {
          const inRange = i >= step.lo && i <= step.hi;
          const inLeftHalf = step.mid !== null && i >= step.lo && i <= step.mid;
          const inRightHalf = step.mid !== null && i > step.mid && i <= step.hi;
          const isScan =
            (step.kind === 'cross-left-scan' || step.kind === 'cross-right-scan') &&
            step.scanIndex === i;
          const isBaseHit = step.kind === 'base' && step.baseIndex === i;
          const isMid = step.mid !== null && i === step.mid;
          const inFinalWinner =
            finalWinner !== null && i >= finalWinner.from && i <= finalWinner.to;

          let cellClass: string;
          if (inFinalWinner) {
            cellClass = 'border-keep bg-keep-soft text-ink font-semibold';
          } else if (isScan || isBaseHit) {
            cellClass = 'border-accent-pop bg-accent-soft text-ink font-semibold';
          } else if (isMid) {
            cellClass = 'border-accent-pop bg-surface text-ink font-medium';
          } else if (inLeftHalf) {
            cellClass = 'border-accent bg-surface text-ink';
          } else if (inRightHalf) {
            cellClass = 'border-keep bg-surface text-ink';
          } else if (inRange) {
            cellClass = 'border-rule bg-surface text-ink';
          } else {
            cellClass = 'border-rule bg-sunk text-ink-faint opacity-40';
          }

          return (
            <div key={i} className="flex flex-col items-center px-0.5">
              <span
                data-lo={i === step.lo ? step.lo : undefined}
                data-mid={step.mid !== null && i === step.mid ? step.mid : undefined}
                data-hi={i === step.hi ? step.hi : undefined}
                data-index={i}
                className={`inline-flex h-9 min-w-9 items-center justify-center rounded border px-2 ${cellClass}`}
              >
                {v}
              </span>
              <span className="mt-0.5 font-mono text-3xs text-ink-faint">{i}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-3xs text-ink-faint">
        <ScanReadout label="izquierda (sufijo desde mid)" value={step.leftBest} />
        <ScanReadout label="derecha (prefijo desde mid+1)" value={step.rightBest} />
        <ScanReadout label="cruce (izq + der)" value={step.crossMax} />
      </div>
    </div>
  );
}

interface ScanReadoutProps {
  label: string;
  value: SubarrayResult | undefined;
}

function ScanReadout({ label, value }: ScanReadoutProps) {
  return (
    <div className="border-t border-rule pt-1">
      <div className="text-ink-faint">{label}</div>
      <div className="text-ink">
        {value === undefined || !Number.isFinite(value.sum)
          ? '—'
          : `[${value.from}..${value.to}] suma ${value.sum}`}
      </div>
    </div>
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
