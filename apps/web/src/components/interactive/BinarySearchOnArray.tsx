import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';

/**
 * The recursive binary-search pseudocode this widget traces against. Same
 * shape as the code shown on the "BS con D&C · diseño" slide so the reader
 * sees the same signature and the same body in both places.
 *
 * ```
 *   1  int bs(int[] a, int lo, int hi, int t) {
 *   2      if (lo > hi) return -1;
 *   3      int mid = (lo + hi) / 2;
 *   4      if (a[mid] == t) return mid;
 *   5      if (t < a[mid]) return bs(a, lo, mid - 1, t);
 *   6      return bs(a, mid + 1, hi, t);
 *   7  }
 * ```
 */
const CODE = `int bs(int[] a, int lo, int hi, int t) {
    if (lo > hi) return -1;
    int mid = (lo + hi) / 2;
    if (a[mid] == t) return mid;
    if (t < a[mid]) return bs(a, lo, mid - 1, t);
    return bs(a, mid + 1, hi, t);
}`;

const LINE = {
  EMPTY_GUARD: 2,
  MID: 3,
  CHECK_EQ: 4,
  RECURSE_LEFT: 5,
  RECURSE_RIGHT: 6,
} as const;

export type BinarySearchStepKind =
  | 'enter' // A new call is entered; lo, hi, mid computed.
  | 'compare' // The comparison a[mid] vs target happens here.
  | 'return-found' // a[mid] == target — return mid up the stack.
  | 'return-not-found' // lo > hi — return -1.
  | 'outcome'; // Cierre with the final result.

export interface BinarySearchStep {
  kind: BinarySearchStepKind;
  lo: number;
  hi: number;
  /** Set on enter/compare steps; null on the empty-range return. */
  mid: number | null;
  /** Only on compare steps: how a[mid] compares to the target. */
  comparison?: 'less' | 'greater' | 'equal';
  /** For return-found and outcome: the index the algorithm reports. */
  returnValue?: number;
  /** Human-readable description of what happened at this step. */
  description: string;
  /** 1-based lines to highlight in the code panel. */
  highlightLines: number[];
}

export interface BinarySearchTrace {
  steps: BinarySearchStep[];
  outcome: { kind: 'found'; index: number } | { kind: 'not-found' };
}

/**
 * Pure trace of the recursive binary-search algorithm over a sorted array.
 * Emits fine-grained steps — one enter per recursive call, one compare per
 * a[mid] check, one return-found/return-not-found on the base case, and a
 * closing 'outcome' step. Exported so tests can pin the shape without
 * touching the DOM.
 */
export function tracesBinarySearch(values: number[], target: number): BinarySearchTrace {
  const steps: BinarySearchStep[] = [];

  function recurse(
    lo: number,
    hi: number,
  ): { kind: 'found'; index: number } | { kind: 'not-found' } {
    if (lo > hi) {
      steps.push({
        kind: 'return-not-found',
        lo,
        hi,
        mid: null,
        description: `Rango vacío (lo=${lo} > hi=${hi}) — target no está en el arreglo. Retorna -1.`,
        highlightLines: [LINE.EMPTY_GUARD],
      });
      return { kind: 'not-found' };
    }
    const mid = Math.floor((lo + hi) / 2);
    steps.push({
      kind: 'enter',
      lo,
      hi,
      mid,
      description: `Llamada bs(a, lo=${lo}, hi=${hi}, t=${target}) — calcular mid = (${lo}+${hi})/2 = ${mid}.`,
      highlightLines: [LINE.MID],
    });
    const at = values[mid]!;
    if (at === target) {
      steps.push({
        kind: 'compare',
        lo,
        hi,
        mid,
        comparison: 'equal',
        description: `a[${mid}] = ${at}, target = ${target}. Coincidencia — return ${mid}.`,
        highlightLines: [LINE.CHECK_EQ],
      });
      steps.push({
        kind: 'return-found',
        lo,
        hi,
        mid,
        returnValue: mid,
        description: `Devuelve ${mid}. La respuesta sube por la cadena de llamadas.`,
        highlightLines: [LINE.CHECK_EQ],
      });
      return { kind: 'found', index: mid };
    }
    if (target < at) {
      steps.push({
        kind: 'compare',
        lo,
        hi,
        mid,
        comparison: 'greater',
        description: `a[${mid}] = ${at}, target = ${target}. Como ${target} < ${at}, el target no puede estar en la mitad derecha ni en mid — recursamos en [${lo}..${mid - 1}].`,
        highlightLines: [LINE.RECURSE_LEFT],
      });
      return recurse(lo, mid - 1);
    }
    steps.push({
      kind: 'compare',
      lo,
      hi,
      mid,
      comparison: 'less',
      description: `a[${mid}] = ${at}, target = ${target}. Como ${at} < ${target}, el target no puede estar en la mitad izquierda ni en mid — recursamos en [${mid + 1}..${hi}].`,
      highlightLines: [LINE.RECURSE_RIGHT],
    });
    return recurse(mid + 1, hi);
  }

  const outcome = recurse(0, values.length - 1);
  // Cierre step — always the last, shows the final result on the array.
  const lastLo = steps[steps.length - 1]?.lo ?? 0;
  const lastHi = steps[steps.length - 1]?.hi ?? values.length - 1;
  if (outcome.kind === 'found') {
    steps.push({
      kind: 'outcome',
      lo: lastLo,
      hi: lastHi,
      mid: outcome.index,
      returnValue: outcome.index,
      description: `✓ ${target} encontrado en índice ${outcome.index}. Buscar ${target} tomó ${countCompares(steps)} comparaciones.`,
      highlightLines: [],
    });
  } else {
    steps.push({
      kind: 'outcome',
      lo: lastLo,
      hi: lastHi,
      mid: null,
      description: `✗ ${target} no está en el arreglo. Buscar ${target} tomó ${countCompares(steps)} comparaciones — igual que un caso encontrado.`,
      highlightLines: [],
    });
  }

  return { steps, outcome };
}

function countCompares(steps: BinarySearchStep[]): number {
  return steps.filter((s) => s.kind === 'compare').length;
}

// ── Widget ──────────────────────────────────────────────────────────────────

export interface BinarySearchOnArrayProps {
  values?: number[];
  target?: number;
  title?: string;
  speed?: number;
  autoplay?: boolean;
}

export function BinarySearchOnArray({
  values,
  target,
  title,
  speed = 1,
  autoplay = false,
}: BinarySearchOnArrayProps) {
  if (values === undefined || values.length === 0) {
    return (
      <AuthoringError component="BinarySearchOnArray">
        falta la prop <code>values</code> (arreglo ordenado no vacío de enteros).
      </AuthoringError>
    );
  }
  for (let i = 1; i < values.length; i += 1) {
    if (values[i]! <= values[i - 1]!) {
      return (
        <AuthoringError component="BinarySearchOnArray">
          <code>values</code> tiene que estar ordenado en orden estrictamente creciente. En la
          posición {i} el valor {values[i]!} no es mayor que {values[i - 1]!}.
        </AuthoringError>
      );
    }
  }
  if (target === undefined || !Number.isInteger(target)) {
    return (
      <AuthoringError component="BinarySearchOnArray">
        falta la prop <code>target</code> (entero a buscar).
      </AuthoringError>
    );
  }

  return <Body values={values} target={target} title={title} speed={speed} autoplay={autoplay} />;
}

interface BodyProps {
  values: number[];
  target: number;
  title?: string;
  speed: number;
  autoplay: boolean;
}

function Body({ values, target, title, speed, autoplay }: BodyProps) {
  const trace = useMemo(() => tracesBinarySearch(values, target), [values, target]);
  const totalSteps = trace.steps.length;

  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);

  // Stable serialised key: MDX creates a new inline array reference on each
  // parent re-render, and depending on `values` directly used to snap
  // stepIndex back to 0 mid-run. Tie the reset to the actual contents.
  const valuesKey = values.join(',');
  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(autoplay);
  }, [valuesKey, target, autoplay]);

  useEffect(() => {
    if (!isPlaying) return;
    if (stepIndex >= totalSteps - 1) {
      setIsPlaying(false);
      return;
    }
    const delay = 900 / Math.max(0.25, speed);
    const timeout = window.setTimeout(() => setStepIndex((s) => s + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [isPlaying, stepIndex, speed, totalSteps]);

  const step = trace.steps[stepIndex]!;

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

  const heading = title ?? `Búsqueda binaria · target = ${target}`;

  return (
    <figure
      data-widget="binary-search-on-array"
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          bs
        </span>
        <h4 className="m-0 text-sm font-medium text-ink">{heading}</h4>
      </header>

      <div className="border-b border-rule">
        <CodeStepper code={CODE} highlightLines={step.highlightLines} language="java" />
      </div>

      <div className="overflow-x-auto px-3 py-4">
        <ArrayVisual values={values} step={step} />
      </div>

      {step.kind === 'compare' ? (
        <ComparePanel values={values} target={target} step={step} />
      ) : null}

      <div className="border-t border-rule bg-sunk px-3 py-2 text-sm text-ink">
        <p className="m-0 font-mono text-xs">
          <span className="text-ink-faint">
            Paso {stepIndex + 1}/{totalSteps} ·{' '}
          </span>
          {step.description}
        </p>
        {step.kind === 'outcome' ? (
          <p className="m-0 mt-1 font-mono text-xs">
            {trace.outcome.kind === 'found' ? (
              <>
                <span className="text-keep">✓ </span>
                <strong>{`${target} encontrado en índice ${trace.outcome.index}`}</strong>
              </>
            ) : (
              <>
                <span className="text-flag">✗ </span>
                <strong>{`${target} no está en el arreglo`}</strong>
              </>
            )}
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

// ── Array visualisation ─────────────────────────────────────────────────────

interface ArrayVisualProps {
  values: number[];
  step: BinarySearchStep;
}

/**
 * Three-row visual: values on top, indices below, lo/mid/hi markers at the
 * foot. Discarded cells (outside [lo..hi]) render as `·` — a stronger signal
 * than opacity fading. On compare steps, mid is highlighted; on enter steps
 * both extremes AND mid are highlighted so the new call frame is legible.
 */
function ArrayVisual({ values, step }: ArrayVisualProps) {
  const inRange = (i: number) => i >= step.lo && i <= step.hi;
  const isWinner = step.kind === 'outcome' && step.mid !== null;

  return (
    <div className="flex min-w-fit flex-col items-start gap-0.5 font-mono text-sm">
      {/* Row 1: values (discarded shown as `·`) */}
      <div className="flex" role="row" aria-label="valores">
        {values.map((v, i) => {
          const cellClass = !inRange(i)
            ? 'border-rule bg-sunk text-ink-faint'
            : isWinner && i === step.mid
              ? 'border-keep bg-keep-soft text-ink font-semibold'
              : step.kind === 'compare' && i === step.mid
                ? 'border-accent-pop bg-accent-soft text-ink font-semibold'
                : i === step.mid
                  ? 'border-accent-pop bg-surface text-ink font-medium'
                  : 'border-accent bg-surface text-ink';
          return (
            <div key={i} className="px-0.5">
              <span
                data-index={i}
                data-active={inRange(i) ? 'true' : undefined}
                className={`inline-flex h-9 min-w-9 items-center justify-center rounded border px-2 ${cellClass}`}
              >
                {inRange(i) ? v : <span aria-label={`descartado ${v}`}>·</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* Row 2: indices */}
      <div className="flex" aria-label="índices">
        {values.map((_, i) => (
          <div key={i} className="px-0.5">
            <span className="inline-flex min-w-9 justify-center font-mono text-3xs text-ink-faint">
              {i}
            </span>
          </div>
        ))}
      </div>

      {/* Row 3: lo/mid/hi markers */}
      <div className="flex" aria-hidden>
        {values.map((_, i) => {
          const labels: string[] = [];
          if (i === step.lo) labels.push('lo');
          if (step.mid !== null && i === step.mid) labels.push('mid');
          if (i === step.hi) labels.push('hi');
          return (
            <div key={i} className="px-0.5">
              <span className="inline-flex min-w-9 justify-center font-mono text-3xs font-semibold text-accent">
                {labels.join(' / ') || ' '}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Compare panel ───────────────────────────────────────────────────────────

interface ComparePanelProps {
  values: number[];
  target: number;
  step: BinarySearchStep;
}

/**
 * Large, focused panel that shows the a[mid] vs target comparison as a
 * headline — separate from the general narration so the pedagogical moment
 * (the decision) is unmissable.
 */
function ComparePanel({ values, target, step }: ComparePanelProps) {
  if (step.mid === null || step.comparison === undefined) return null;
  const midValue = values[step.mid]!;
  const symbol = step.comparison === 'equal' ? '==' : step.comparison === 'less' ? '<' : '>';
  const conclusion =
    step.comparison === 'equal'
      ? '→ coincidencia'
      : step.comparison === 'less'
        ? '→ recursar a la derecha'
        : '→ recursar a la izquierda';
  return (
    <div
      data-panel="compare"
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-rule bg-accent-soft px-3 py-2 font-mono text-sm text-ink"
    >
      <span className="text-3xs tracking-wide text-accent uppercase">comparar</span>
      <span>
        a[{step.mid}] = <strong>{midValue}</strong>
      </span>
      <span className="text-ink-faint">{symbol}</span>
      <span>
        target = <strong>{target}</strong>
      </span>
      <span className="text-accent-pop">{conclusion}</span>
    </div>
  );
}

// ── Controls ────────────────────────────────────────────────────────────────

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
