import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';
import { DivideCombineTree } from './DivideCombineTree';
import { CODE, traceFor, type SortAlgorithm, type SortStep } from './sortStepperTrace';

export interface SortStepperProps {
  /** Which sorting algorithm to trace. */
  algorithm?: SortAlgorithm | string;
  /** The input array. Kept small — 6-10 elements read best on a slide. */
  values?: number[];
  /** Playback default. Autoplay off unless the author asks (rule Peli 1/2). */
  autoplay?: boolean;
  /** Playback speed. `slow` ≈ 1200ms/step, `normal` ≈ 700ms, `fast` ≈ 300ms. */
  speed?: 'slow' | 'normal' | 'fast';
  /** Show the code panel on top of the bars. Default true. */
  showCode?: boolean;
  /** For `merge` and `quick`: show the divide/combine tree beside the bars.
   * Default true. Ignored for the n² algorithms (they have no tree). */
  showTree?: boolean;
  /** Widget header override. */
  title?: string;
}

const KNOWN_ALGORITHMS: readonly SortAlgorithm[] = [
  'bubble',
  'selection',
  'insertion',
  'merge',
  'quick',
] as const;

const SPEED_MS: Record<'slow' | 'normal' | 'fast', number> = {
  slow: 1200,
  normal: 700,
  fast: 300,
};

/**
 * `<SortStepper>` — the axis widget of the "Ordenamiento" class (ADR-0065).
 *
 * Renders the code of the algorithm on top (`<CodeStepper>` with the current
 * line highlighted), the array as vertical bars with per-frame overlays, and
 * — for the D&C algorithms — the mergesort/quicksort tree via
 * `<DivideCombineTree>` (ADR-0064 hooks). Controls at the foot: reset, prev,
 * play/pause, next.
 */
export function SortStepper({
  algorithm,
  values,
  autoplay = false,
  speed = 'normal',
  showCode = true,
  showTree = true,
  title,
}: SortStepperProps) {
  if (algorithm === undefined || !KNOWN_ALGORITHMS.includes(algorithm as SortAlgorithm)) {
    return (
      <AuthoringError component="SortStepper">
        {algorithm === undefined ? (
          <>
            falta la prop <code>algorithm</code>. Valores: {KNOWN_ALGORITHMS.join(', ')}.
          </>
        ) : (
          <>
            «{algorithm}» no es un algoritmo conocido. Hoy son {KNOWN_ALGORITHMS.join(', ')}.
          </>
        )}
      </AuthoringError>
    );
  }
  if (values === undefined || values.length === 0) {
    return (
      <AuthoringError component="SortStepper">
        falta la prop <code>values</code> (arreglo no vacío).
      </AuthoringError>
    );
  }
  if (values.length > 12) {
    return (
      <AuthoringError component="SortStepper">
        <code>values</code> tiene {values.length} elementos. El widget se lee bien con 6-10; más de
        12 hace ilegible la comparación paso a paso.
      </AuthoringError>
    );
  }
  return (
    <Body
      algorithm={algorithm as SortAlgorithm}
      values={values}
      autoplay={autoplay}
      speed={speed}
      showCode={showCode}
      showTree={showTree}
      title={title}
    />
  );
}

interface BodyProps {
  algorithm: SortAlgorithm;
  values: number[];
  autoplay: boolean;
  speed: 'slow' | 'normal' | 'fast';
  showCode: boolean;
  showTree: boolean;
  title?: string;
}

function Body({ algorithm, values, autoplay, speed, showCode, showTree, title }: BodyProps) {
  const valuesKey = values.join(',');
  const trace = useMemo(
    () => traceFor(algorithm, valuesKey.split(',').map(Number)),
    [algorithm, valuesKey],
  );
  const totalSteps = trace.steps.length;

  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);

  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(autoplay);
  }, [algorithm, valuesKey, autoplay]);

  useEffect(() => {
    if (!isPlaying) return;
    if (stepIndex >= totalSteps - 1) {
      setIsPlaying(false);
      return;
    }
    const delay = SPEED_MS[speed];
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

  const treeAlgo = algorithm === 'merge' ? 'mergesort' : algorithm === 'quick' ? 'quicksort' : null;
  const showTreePanel = showTree && treeAlgo !== null;

  const heading = title ?? headingFor(algorithm);

  return (
    <figure
      data-widget="sort-stepper"
      data-algorithm={algorithm}
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          sort
        </span>
        <h4 className="m-0 text-sm font-medium text-ink">{heading}</h4>
      </header>

      {showCode ? (
        <div className="border-b border-rule">
          <CodeStepper
            code={CODE[algorithm]}
            highlightLines={step.highlightLines}
            language="java"
          />
        </div>
      ) : null}

      <div
        className={`flex flex-col gap-4 px-3 py-4 ${
          showTreePanel ? 'lg:flex-row lg:items-start' : ''
        }`}
      >
        <div className={`flex flex-col gap-3 ${showTreePanel ? 'lg:flex-1' : ''}`}>
          <BarChart values={values} step={step} />
          {step.auxRail ? <AuxRail rail={step.auxRail} /> : null}
        </div>
        {showTreePanel && treeAlgo ? (
          <div className="lg:w-1/2 lg:min-w-0">
            <DivideCombineTree
              recipe={treeAlgo}
              values={values}
              highlightNode={step.callNode}
              nodeAnnotations={
                step.callNode !== undefined && step.callAnnotation !== undefined
                  ? { [step.callNode]: step.callAnnotation }
                  : undefined
              }
            />
          </div>
        ) : null}
      </div>

      <div className="border-t border-rule bg-sunk px-3 py-2 text-sm text-ink">
        <p className="m-0 font-mono text-xs">
          <span className="text-ink-faint">
            Paso {stepIndex + 1}/{totalSteps} ·{' '}
          </span>
          {step.description}
        </p>
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

// ── Bar chart ────────────────────────────────────────────────────────────

interface BarChartProps {
  values: number[];
  step: SortStep;
}

/**
 * Vertical bars, height proportional to value. Each bar carries semantic
 * `data-*` attributes so a browser check (and the suite) can identify what
 * the frame is showing — active / sorted / pivot / out-of-range — without
 * inspecting paint.
 */
function BarChart({ values, step }: BarChartProps) {
  const max = Math.max(...values, ...step.array);
  const activeSet = new Set(step.active);
  const inSubarray = (i: number) =>
    step.subarray === undefined || (i >= step.subarray[0] && i <= step.subarray[1]);
  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex min-w-fit items-end gap-1"
        role="row"
        aria-label="valores"
        style={{ height: '10rem' }}
      >
        {step.array.map((v, i) => {
          const isActive = activeSet.has(i);
          const isPivot = step.pivot === i;
          const isSortedPrefix = step.sortedPrefix !== undefined && i < step.sortedPrefix;
          const isSortedSuffix =
            step.sortedSuffix !== undefined && i >= step.array.length - step.sortedSuffix;
          const isOutOfSubarray = !inSubarray(i);
          const barClass = isOutOfSubarray
            ? 'border-rule bg-sunk opacity-40'
            : isPivot
              ? 'border-accent-pop bg-accent-pop text-surface'
              : isActive
                ? 'border-accent-pop bg-accent-soft text-ink'
                : isSortedPrefix || isSortedSuffix
                  ? 'border-keep bg-keep-soft text-ink'
                  : 'border-accent bg-surface text-ink';
          const heightPct = (v / max) * 100;
          const status = isPivot
            ? 'pivot'
            : isActive
              ? 'active'
              : isSortedPrefix || isSortedSuffix
                ? 'sorted'
                : isOutOfSubarray
                  ? 'out-of-range'
                  : 'normal';
          return (
            <div key={i} className="flex flex-col items-center" style={{ width: '1.75rem' }}>
              <div
                data-index={i}
                data-value={v}
                data-status={status}
                className={`flex w-full items-end justify-center rounded border ${barClass} font-mono text-3xs`}
                style={{ height: `${heightPct}%`, minHeight: '1rem' }}
              >
                <span className="px-0.5 pb-0.5">{v}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex min-w-fit gap-1" aria-label="índices">
        {step.array.map((_, i) => (
          <div
            key={i}
            className="flex justify-center font-mono text-3xs text-ink-faint"
            style={{ width: '1.75rem' }}
          >
            {i}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Aux rail (merge) ─────────────────────────────────────────────────────

function AuxRail({ rail }: { rail: (number | null)[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-3xs tracking-wide text-ink-faint uppercase">aux</span>
      <div className="flex min-w-fit gap-1" role="row" aria-label="buffer auxiliar">
        {rail.map((v, i) => (
          <div
            key={i}
            data-aux-index={i}
            data-aux-value={v ?? ''}
            className={`inline-flex h-7 items-center justify-center rounded border font-mono text-xs ${
              v === null
                ? 'border-rule bg-sunk text-ink-faint'
                : 'border-keep bg-keep-soft text-ink'
            }`}
            style={{ width: '1.75rem' }}
          >
            {v === null ? '·' : v}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Controls ─────────────────────────────────────────────────────────────

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

function headingFor(algorithm: SortAlgorithm): string {
  switch (algorithm) {
    case 'bubble':
      return 'Bubble sort · paso a paso';
    case 'selection':
      return 'Selection sort · paso a paso';
    case 'insertion':
      return 'Insertion sort · paso a paso';
    case 'merge':
      return 'Mergesort · paso a paso';
    case 'quick':
      return 'Quicksort · paso a paso';
  }
}
