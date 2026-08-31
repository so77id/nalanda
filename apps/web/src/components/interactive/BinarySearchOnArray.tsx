import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';

/**
 * The pseudocode the widget shows and traces against. The line numbers below
 * are 1-based and match the highlight-line targeting in `LINE`.
 *
 * ```
 *   1  int busquedaBinaria(int[] a, int t) {
 *   2      int lo = 0, hi = a.length - 1;
 *   3      while (lo <= hi) {
 *   4          int mid = (lo + hi) / 2;
 *   5          if (a[mid] == t) return mid;
 *   6          if (a[mid] < t) lo = mid + 1;
 *   7          else hi = mid - 1;
 *   8      }
 *   9      return -1;
 *  10  }
 * ```
 */
const CODE = `int busquedaBinaria(int[] a, int t) {
    int lo = 0, hi = a.length - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (a[mid] == t) return mid;
        if (a[mid] < t) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}`;

const LINE = {
  MID: 4,
  CHECK_EQ: 5,
  CHECK_LT: 6,
  CHECK_GT: 7,
  RETURN_NOT_FOUND: 9,
} as const;

/** One iteration of the loop, ready for playback. */
export interface BinarySearchStep {
  lo: number;
  hi: number;
  mid: number;
  /** How `a[mid]` compared to the target. */
  comparison: 'equal' | 'less' | 'greater';
  /** The reader-facing narration of what this step just decided. */
  description: string;
  /** 1-based lines to highlight in the code panel. */
  highlightLines: number[];
}

export interface BinarySearchTrace {
  steps: BinarySearchStep[];
  outcome: { kind: 'found'; index: number } | { kind: 'not-found' };
}

/**
 * Pure trace of the binary-search algorithm over a sorted array. Exported so
 * the test can pin the trace shape without touching the DOM, and so a course
 * document can (in principle) reuse the same events for a different
 * presentation.
 */
export function tracesBinarySearch(values: number[], target: number): BinarySearchTrace {
  const steps: BinarySearchStep[] = [];
  let lo = 0;
  let hi = values.length - 1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const at = values[mid]!;
    let comparison: BinarySearchStep['comparison'];
    let description: string;
    let highlightLines: number[];

    if (at === target) {
      comparison = 'equal';
      description = `a[${mid}] = ${at} = ${target} → encontrado en ${mid}`;
      highlightLines = [LINE.MID, LINE.CHECK_EQ];
      steps.push({ lo, hi, mid, comparison, description, highlightLines });
      return { steps, outcome: { kind: 'found', index: mid } };
    }

    if (at < target) {
      comparison = 'less';
      description = `a[${mid}] = ${at} < ${target} → lo = ${mid + 1}`;
      highlightLines = [LINE.MID, LINE.CHECK_LT];
      steps.push({ lo, hi, mid, comparison, description, highlightLines });
      lo = mid + 1;
    } else {
      comparison = 'greater';
      description = `a[${mid}] = ${at} > ${target} → hi = ${mid - 1}`;
      highlightLines = [LINE.MID, LINE.CHECK_GT];
      steps.push({ lo, hi, mid, comparison, description, highlightLines });
      hi = mid - 1;
    }
  }

  return { steps, outcome: { kind: 'not-found' } };
}

export interface BinarySearchOnArrayProps {
  /** Sorted (strictly increasing) array of integers to search over. */
  values?: number[];
  /** The integer to search for. May or may not be present. */
  target?: number;
  /** Header override. */
  title?: string;
  /** Playback speed multiplier: 0.5, 1, or 2. Defaults to 1. */
  speed?: number;
  /** Auto-play from the start when mounted (single pass, does not loop). */
  autoplay?: boolean;
}

/**
 * Binary-search visualiser (ADR-0059) — code on top with the active line
 * highlighted, array below with `lo`, `mid` and `hi` markers, controls at the
 * foot. Steps through the same trace on every render; the panel of the
 * current step narrates what the algorithm just decided. On completion the
 * panel emphasises the STEP COUNT — found and not-found take the same number
 * of comparisons, and that is a pedagogical point of the deck.
 */
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

  // Step index is 0..totalSteps. The value AFTER the last step is `totalSteps`
  // itself, which the widget renders as "finished": the outcome panel shows,
  // no lo/mid/hi remains highlighted. Sitting AT the last step (totalSteps - 1)
  // is different: the last comparison is on screen, the outcome message also
  // renders because the trace is finished but the reader is looking at the
  // step that resolved it.
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);

  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(autoplay);
  }, [values, target, autoplay]);

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

  const currentStep = trace.steps[stepIndex];
  const showOutcome = stepIndex === totalSteps - 1;

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
        <CodeStepper
          code={CODE}
          highlightLines={currentStep?.highlightLines ?? []}
          language="java"
        />
      </div>

      <div className="overflow-x-auto px-3 py-4">
        <ArrayVisual values={values} step={currentStep} />
      </div>

      <div className="border-t border-rule bg-sunk px-3 py-2 text-sm text-ink">
        {showOutcome ? (
          <OutcomeMessage outcome={trace.outcome} target={target} steps={totalSteps} />
        ) : (
          <p className="m-0 font-mono text-xs">
            <span className="text-ink-faint">
              Paso {stepIndex + 1}/{totalSteps}:{' '}
            </span>
            {currentStep?.description}
          </p>
        )}
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
  step: BinarySearchStep | undefined;
}

function ArrayVisual({ values, step }: ArrayVisualProps) {
  return (
    <div className="flex min-w-fit flex-col items-start gap-2 font-mono text-sm">
      <div className="flex items-end">
        {values.map((v, i) => {
          const isInRange = step !== undefined && i >= step.lo && i <= step.hi;
          const isMid = step !== undefined && i === step.mid;
          const cellClass = isMid
            ? 'border-accent-pop bg-accent-soft text-ink font-semibold'
            : isInRange
              ? 'border-accent bg-surface text-ink'
              : 'border-rule bg-sunk text-ink-faint opacity-50';
          return (
            <div key={i} className="flex flex-col items-center px-0.5">
              <span
                data-lo={step !== undefined && i === step.lo ? step.lo : undefined}
                data-mid={step !== undefined && i === step.mid ? step.mid : undefined}
                data-hi={step !== undefined && i === step.hi ? step.hi : undefined}
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

      {step === undefined ? null : (
        <div className="flex" aria-hidden>
          {values.map((_, i) => {
            const labels: string[] = [];
            if (i === step.lo) labels.push('lo');
            if (i === step.mid) labels.push('mid');
            if (i === step.hi) labels.push('hi');
            return (
              <div key={i} className="flex flex-col items-center px-0.5">
                <span className="min-w-9 text-center font-mono text-3xs text-accent">
                  {labels.join(' / ') || ' '}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface OutcomeMessageProps {
  outcome: BinarySearchTrace['outcome'];
  target: number;
  steps: number;
}

function OutcomeMessage({ outcome, target, steps }: OutcomeMessageProps) {
  if (outcome.kind === 'found') {
    return (
      <p className="m-0 font-mono text-xs">
        <span className="text-keep">✓ </span>
        <strong>{`${target} encontrado en índice ${outcome.index}`}</strong>
        {` — buscar ${target} tomó `}
        <strong>{`${steps} pasos`}</strong>
        {'.'}
      </p>
    );
  }
  return (
    <p className="m-0 font-mono text-xs">
      <span className="text-flag">✗ </span>
      <strong>{`${target} no está en el arreglo`}</strong>
      {` — buscar ${target} requirió `}
      <strong>{`${steps} pasos`}</strong>
      {' igual que un caso encontrado.'}
    </p>
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
