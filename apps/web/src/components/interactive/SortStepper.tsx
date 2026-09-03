import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useMode } from '../../presentation';
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
 * line highlighted), the array as vertical bars whose HEIGHT is proportional
 * to value (Sedgewick-style), with a pointer row below marking `i`, `j`,
 * `min` or `pivot`, and — for the D&C algorithms — `<DivideCombineTree>`
 * (ADR-0064 hooks) synchronised alongside. Controls at the foot.
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
  const mode = useMode();
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

  const isPresentation = mode === 'presentation';

  // In presentation mode, break out of the slide's prose max-width and use
  // the whole viewport (the pedagogical use case wants the widget to breathe).
  // The trick: position:relative with left:50% + translate:-50% + w:100vw
  // makes the element span the viewport regardless of its parent's width.
  const outerClass = isPresentation
    ? 'not-prose my-6 relative left-1/2 -translate-x-1/2 w-screen max-w-[100vw] overflow-hidden rounded-lg border border-rule bg-surface text-ink'
    : 'not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink';

  // Presentation lays out code | bars | tree in three columns (or code | bars
  // for n² sorts, since there is no tree). Book stacks vertically — code on
  // top full-width, then bars, then tree (D&C only).
  const heading = title ?? headingFor(algorithm);

  // Shared "column card" wrapper — used only in the presentation grid so
  // each of the three panels reads as its own bounded box with a matching
  // heading strip.
  const columnCard = 'flex min-w-0 min-h-0 flex-col rounded border border-rule bg-surface';
  const columnLabel =
    'flex items-center gap-2 border-b border-rule bg-sunk px-2 py-1 font-mono text-3xs uppercase tracking-wide text-ink-faint';

  return (
    <figure
      data-widget="sort-stepper"
      data-algorithm={algorithm}
      data-mode={mode}
      className={outerClass}
    >
      <header className="flex items-center justify-between gap-2 bg-sunk px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
            sort
          </span>
          <h4 className="m-0 text-sm font-medium text-ink">{heading}</h4>
        </div>
        <span className="font-mono text-3xs text-ink-faint">
          Paso {stepIndex + 1}/{totalSteps}
        </span>
      </header>

      {isPresentation ? (
        // Presentation grid: 3 (or 2) equal columns, each capped at the
        // same height so the reader's eye can compare the three panels
        // side by side. `min-h-0` on children lets the internal scroll
        // areas actually scroll.
        <div
          className={`grid gap-2 px-3 py-3 ${
            showTreePanel
              ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]'
              : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'
          }`}
          style={{ height: 'min(70vh, 720px)' }}
        >
          {showCode ? (
            <div className={columnCard}>
              <div className={columnLabel}>
                <span>1 · código</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <CodeStepper
                  code={CODE[algorithm]}
                  highlightLines={step.highlightLines}
                  language="java"
                />
              </div>
            </div>
          ) : null}
          <div className={columnCard}>
            <div className={columnLabel}>
              <span>{showCode ? '2' : '1'} · arreglo</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <BarChart step={step} algorithm={algorithm} tallInPresentation />
              {step.auxRail ? (
                <div className="mt-3">
                  <AuxRail rail={step.auxRail} />
                </div>
              ) : null}
            </div>
          </div>
          {showTreePanel && treeAlgo ? (
            <div className={columnCard}>
              <div className={columnLabel}>
                <span>{showCode ? '3' : '2'} · árbol</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3">
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
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {showCode ? (
            <div className="border-b border-rule">
              <CodeStepper
                code={CODE[algorithm]}
                highlightLines={step.highlightLines}
                language="java"
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-4 px-3 py-4">
            <div className="flex min-w-0 flex-col gap-3">
              <BarChart step={step} algorithm={algorithm} />
              {step.auxRail ? <AuxRail rail={step.auxRail} /> : null}
            </div>
            {showTreePanel && treeAlgo ? (
              <div className="min-w-0">
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
        </>
      )}

      <div className="border-t border-rule bg-sunk px-3 py-2 text-sm text-ink">
        <p className="m-0 font-mono text-xs">{step.description}</p>
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
        <div className="ml-auto flex items-center gap-3 font-mono text-3xs text-ink-faint">
          <LegendSwatch swatchClass="border-accent bg-surface" label="sin tocar" />
          <LegendSwatch swatchClass="border-accent-pop bg-accent-soft" label="activo" />
          {algorithm === 'quick' && (
            <LegendSwatch swatchClass="border-accent-pop bg-accent-pop" label="pivot" />
          )}
          <LegendSwatch swatchClass="border-keep bg-keep-soft" label="ordenado" />
        </div>
      </div>
    </figure>
  );
}

// ── Bar chart ────────────────────────────────────────────────────────────

interface BarChartProps {
  step: SortStep;
  algorithm: SortAlgorithm;
  /** In presentation mode, give the bar row generous vertical space. */
  tallInPresentation?: boolean;
}

/**
 * Vertical bars — height proportional to value (Sedgewick-style). Each bar
 * carries semantic `data-*` attributes for the browser check. Below the
 * bars, an index row (0, 1, 2, …) and a pointer row that names the active
 * indices per algorithm (`i`, `j`, `min`, `pivot`).
 *
 * Height is realised on the parent flex row (fixed rem) and each column is
 * `h-full` so `height: N%` on the bar itself resolves against the row's
 * real pixels — the reason the earlier version rendered flat.
 */
function BarChart({ step, algorithm, tallInPresentation = false }: BarChartProps) {
  const max = Math.max(...step.array);
  const activeSet = new Set(step.active);
  const inSubarray = (i: number) =>
    step.subarray === undefined || (i >= step.subarray[0] && i <= step.subarray[1]);
  const pointers = pointersForFrame(step, algorithm);
  const carry = step.carry;

  return (
    <div className="flex flex-col gap-1">
      {/* Carry row — the value held OUTSIDE the array (insertion sort's `v`).
       * When there's no carry, the row is invisible but keeps its height so
       * the bar row does not jump between frames. */}
      <div className="flex min-w-fit gap-1" aria-label="carta">
        {step.array.map((_, i) => (
          <div key={i} className="flex justify-center" style={{ width: '2.25rem' }}>
            {carry && carry.index === i ? (
              <span
                data-carry
                data-carry-value={carry.value}
                data-carry-index={i}
                className="inline-flex flex-col items-center"
              >
                <span className="rounded border-2 border-accent-pop bg-accent-soft px-1.5 py-0.5 font-mono text-xs font-bold text-accent shadow-sm">
                  {carry.value}
                </span>
                <span className="font-mono text-3xs font-semibold text-accent leading-none mt-0.5">
                  ↓ {carry.label}
                </span>
              </span>
            ) : (
              <span className="block h-9" aria-hidden />
            )}
          </div>
        ))}
      </div>
      {/* Bar row — fixed height, so percentage heights on children resolve. */}
      <div
        className="flex min-w-fit items-end gap-1"
        role="row"
        aria-label="valores"
        style={{ height: tallInPresentation ? '22rem' : '11rem' }}
      >
        {step.array.map((v, i) => {
          const isActive = activeSet.has(i);
          const isPivot = step.pivot === i;
          const isSortedPrefix = step.sortedPrefix !== undefined && i < step.sortedPrefix;
          const isSortedSuffix =
            step.sortedSuffix !== undefined && i >= step.array.length - step.sortedSuffix;
          const isOutOfSubarray = !inSubarray(i);
          const barClass = isOutOfSubarray
            ? 'border-rule bg-sunk text-ink-faint opacity-50'
            : isPivot
              ? 'border-accent-pop bg-accent-pop text-surface'
              : isActive
                ? 'border-accent-pop bg-accent-soft text-ink'
                : isSortedPrefix || isSortedSuffix
                  ? 'border-keep bg-keep-soft text-ink'
                  : 'border-accent bg-surface text-ink';
          // Minimum 12% so a value of 0 or 1 is still visible; scale the rest
          // proportional to max.
          const heightPct = Math.max(12, (v / Math.max(1, max)) * 100);
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
            <div key={i} className="flex h-full flex-col justify-end" style={{ width: '2.25rem' }}>
              <div
                data-index={i}
                data-value={v}
                data-status={status}
                className={`flex w-full items-end justify-center rounded border-2 font-mono text-xs font-semibold ${barClass}`}
                style={{ height: `${heightPct}%` }}
              >
                <span className="px-0.5 pb-1">{v}</span>
              </div>
            </div>
          );
        })}
      </div>
      {/* Index row. */}
      <div className="flex min-w-fit gap-1" aria-label="índices">
        {step.array.map((_, i) => (
          <div
            key={i}
            className="flex justify-center font-mono text-3xs text-ink-faint"
            style={{ width: '2.25rem' }}
          >
            {i}
          </div>
        ))}
      </div>
      {/* Pointer row — i / j / min / pivot named under the active columns. */}
      <div className="flex min-w-fit gap-1" aria-label="punteros">
        {step.array.map((_, i) => {
          const labels = pointers.get(i) ?? [];
          return (
            <div key={i} className="flex justify-center gap-0.5" style={{ width: '2.25rem' }}>
              {labels.map((lbl) => (
                <span
                  key={lbl}
                  data-pointer={lbl}
                  className={`inline-flex min-w-4 items-center justify-center rounded border px-1 font-mono text-3xs font-semibold ${pointerClass(lbl)}`}
                >
                  {lbl}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Which text labels ("i", "j", "min", "pivot") sit under each column for
 * this frame — derived from the step's kind + `active` + `pivot`. Multiple
 * labels can share a column (i and j may coincide). */
function pointersForFrame(step: SortStep, algorithm: SortAlgorithm): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const push = (i: number, lbl: string) => {
    const arr = out.get(i) ?? [];
    if (!arr.includes(lbl)) arr.push(lbl);
    out.set(i, arr);
  };
  if (step.pivot !== undefined) push(step.pivot, 'pivot');
  if (algorithm === 'selection') {
    // active is [j, min] on compare frames, [i] on select-min updates, [i, min] on swap.
    if (step.kind === 'compare' && step.active.length >= 2) {
      push(step.active[0]!, 'j');
      push(step.active[1]!, 'min');
    } else if (step.kind === 'select-min') {
      if (step.active.length === 2) {
        push(step.active[0]!, 'i');
        push(step.active[1]!, 'min');
      } else if (step.active.length === 1) {
        push(step.active[0]!, 'min');
      }
    } else if (step.kind === 'swap' && step.active.length === 2) {
      push(step.active[0]!, 'i');
      push(step.active[1]!, 'min');
    }
  } else if (algorithm === 'insertion') {
    if (step.kind === 'select-min' && step.active.length === 1) {
      push(step.active[0]!, 'i');
    } else if (step.kind === 'compare' && step.active.length === 2) {
      push(step.active[0]!, 'j');
      push(step.active[1]!, 'i');
    } else if (step.kind === 'shift' && step.active.length === 2) {
      push(step.active[0]!, 'j');
    } else if (step.kind === 'insert' && step.active.length === 1) {
      push(step.active[0]!, 'v→');
    }
  } else if (algorithm === 'bubble') {
    if ((step.kind === 'compare' || step.kind === 'swap') && step.active.length === 2) {
      push(step.active[0]!, 'j');
      push(step.active[1]!, 'j+1');
    }
  } else if (algorithm === 'quick') {
    if (step.kind === 'partition-scan' && step.active.length === 1) {
      push(step.active[0]!, 'i');
    }
  }
  return out;
}

function pointerClass(label: string): string {
  if (label === 'pivot') return 'border-accent-pop bg-accent-pop text-surface';
  if (label === 'min') return 'border-keep bg-keep-soft text-ink';
  if (label === 'v→') return 'border-accent-pop bg-accent-soft text-accent';
  return 'border-accent bg-accent-soft text-accent';
}

// ── Aux rail (merge) ─────────────────────────────────────────────────────

function AuxRail({ rail }: { rail: (number | null)[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-3xs tracking-wide text-ink-faint uppercase">buffer aux</span>
      <div className="flex min-w-fit gap-1" role="row" aria-label="buffer auxiliar">
        {rail.map((v, i) => (
          <div
            key={i}
            data-aux-index={i}
            data-aux-value={v ?? ''}
            className={`inline-flex h-8 items-center justify-center rounded border font-mono text-sm ${
              v === null
                ? 'border-rule bg-sunk text-ink-faint'
                : 'border-keep bg-keep-soft text-ink font-semibold'
            }`}
            style={{ width: '2.25rem' }}
          >
            {v === null ? '·' : v}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Controls + legend ────────────────────────────────────────────────────

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

function LegendSwatch({ swatchClass, label }: { swatchClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-3 w-3 rounded border ${swatchClass}`} aria-hidden />
      {label}
    </span>
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
