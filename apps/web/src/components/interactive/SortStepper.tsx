import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useMode } from '../../presentation';
import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';
import { DivideCombineTree } from './DivideCombineTree';
import { CODE, traceFor, type SortAlgorithm, type SortStep } from './sortStepperTrace';
import { useViewportBreakout } from './useViewportBreakout';

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
  const [liveSpeed, setLiveSpeed] = useState<'slow' | 'normal' | 'fast'>(speed);
  // Keep the local speed in sync if the author re-authors the prop.
  useEffect(() => setLiveSpeed(speed), [speed]);

  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(autoplay);
  }, [algorithm, valuesKey, autoplay]);

  // In book mode a page may host FIVE steppers (one per algorithm). Every
  // one that has been played and left mid-run keeps firing setTimeouts on
  // its own schedule, and CodeMirror + tree + bar chart re-render on each
  // tick — five parallel loops together lock the tab. Pause playback for
  // any widget the reader has scrolled away from; resume when it comes
  // back into view.
  const [isVisible, setIsVisible] = useState(true);
  useEffect(() => {
    const el = outerRef.current;
    if (!el || typeof IntersectionObserver !== 'function') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    if (!isVisible) return;
    if (stepIndex >= totalSteps - 1) {
      setIsPlaying(false);
      return;
    }
    const delay = SPEED_MS[liveSpeed];
    const timeout = window.setTimeout(() => setStepIndex((s) => s + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [isPlaying, isVisible, stepIndex, liveSpeed, totalSteps]);

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

  // Widgets with a tree (mergesort, quicksort) fill the viewport in
  // presentation — the tree needs the room. Widgets without a tree (bubble,
  // selection, insertion) take 75%: enough for code + array side by side,
  // but not the visual bloat of an empty third of screen. The measurement
  // dance itself is shared with any other widget that needs to breathe in
  // presentation (see `useViewportBreakout`).
  const outerRef = useRef<HTMLElement | null>(null);
  // 75 % of the viewport in presentation — even the D&C widget with a tree
  // fits at that width thanks to the two-row layout below (code + arreglo
  // top, tree full-widget-width bottom). Full-viewport was overkill and
  // pushed the widget's frame beyond the slide's visual margins.
  useViewportBreakout(outerRef, {
    enabled: isPresentation,
    fraction: 0.75,
    deps: [algorithm, valuesKey],
  });

  const outerClass = isPresentation
    ? 'not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink'
    : 'not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink';

  // Presentation lays out code | bars | tree in three columns (or code | bars
  // for n² sorts, since there is no tree). Book stacks vertically — code on
  // top full-width, then bars, then tree (D&C only).
  const heading = title ?? headingFor(algorithm);

  // Shared "column card" wrapper — used only in the presentation grid so
  // each of the three panels reads as its own bounded box with a matching
  // heading strip.
  const columnCard = 'flex min-w-0 min-h-0 flex-col rounded border border-rule bg-surface';

  const progressPct = totalSteps > 1 ? ((stepIndex + 1) / totalSteps) * 100 : 100;

  return (
    <figure
      ref={outerRef}
      data-widget="sort-stepper"
      data-algorithm={algorithm}
      data-mode={mode}
      className={outerClass}
    >
      <header className="flex items-center justify-between gap-3 bg-sunk px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
            sort · {fullAlgorithmName(algorithm)}
          </span>
          <h4 className="m-0 text-sm font-medium text-ink">{heading}</h4>
        </div>
        {/* Big step counter — the reader's anchor for "where are we in this
         * algo run" (pedagogical mockup ANCLA · qué significa). */}
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-xs text-ink-faint">paso</span>
          <span className="font-mono text-lg font-bold leading-none text-ink">
            {stepIndex + 1}
            <span className="font-medium text-ink-faint"> / {totalSteps}</span>
          </span>
          <div
            className="h-2 w-24 overflow-hidden rounded border border-rule bg-surface"
            role="progressbar"
            aria-valuenow={stepIndex + 1}
            aria-valuemin={1}
            aria-valuemax={totalSteps}
          >
            <div
              className="h-full rounded-sm bg-accent-pop transition-[width] duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </header>

      {isPresentation ? (
        // Presentation layout: for D&C sorts the tree needs the full
        // viewport width (a mergesort/quicksort of 8 chips at text-sm is
        // ~1200 px wide, which no 3-column grid can honour). We therefore
        // split into TWO ROWS: code + arreglo up top (55/45), tree
        // full-width below. For n² sorts (no tree) we fall back to one
        // row of two equal columns. The container height is fixed so
        // annotations / aux rail / carry chips do not visibly re-flow the
        // widget between frames.
        <div className="flex flex-col gap-2 px-3 py-3" style={{ height: 'min(90vh, 900px)' }}>
          <div
            className={`grid min-h-0 gap-2 ${
              showTreePanel
                ? // Top row when a tree follows below: code slightly wider
                  // (55/45) so the widest merge signature fits without
                  // clipping (`static void merge(int[] a, int lo, int
                  // mid, int hi) {` = ~55 chars ≈ 620 px at text-sm) while
                  // still leaving the arreglo enough room for 8 bars.
                  'grid-cols-[minmax(0,11fr)_minmax(0,9fr)]'
                : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'
            }`}
            // Top row takes 40 % of the widget height; the tree gets the
            // remaining 60 % since it is the pedagogical focus of D&C.
            // For n² sorts (no tree row) the top row grows to fill.
            style={{ flex: showTreePanel ? '0 0 40%' : '1 1 auto' }}
          >
            {showCode ? (
              <div className={columnCard}>
                <PanelLabel
                  index={1}
                  label="código"
                  hint={
                    step.highlightLines.length > 0
                      ? `Java · línea ${step.highlightLines[0]}`
                      : 'Java'
                  }
                />
                {/* Stretch the CodeStepper (and every layer CodeMirror
                 * nests inside it) to fill the panel's vertical space —
                 * otherwise Java snippets of ~9 lines leave a big empty
                 * area below reading as visual void. `!` uses Tailwind's
                 * important prefix so we win against CodeMirror's inline
                 * heights. Code size scales with the array bucket: n²
                 * sorts (no tree, `pres-large`) get `text-base` because
                 * the code panel owns half the widget with no tree below
                 * competing for room; D&C sorts stay at `text-xs` so the
                 * top row's compact code + arreglo leaves height for the
                 * tree below. */}
                <div
                  className={`min-h-0 flex-1 overflow-hidden bg-surface [&>div]:!h-full [&_.cm-content]:!min-h-full [&_.cm-editor]:!h-full [&_.cm-scroller]:!h-full [&_.cm-theme-dark]:!h-full [&_.cm-theme-light]:!h-full ${
                    showTreePanel
                      ? 'text-xs [&_.cm-editor]:!text-xs'
                      : 'text-base [&_.cm-editor]:!text-base'
                  }`}
                >
                  <CodeStepper
                    code={CODE[algorithm]}
                    highlightLines={step.highlightLines}
                    language="java"
                  />
                </div>
              </div>
            ) : null}
            <div className={columnCard}>
              <PanelLabel
                index={showCode ? 2 : 1}
                label="arreglo"
                hint={arrayHint(step, algorithm)}
              />
              {/* Center the array (bars + aux buffer) both horizontally
               * and vertically in the panel — the arreglo is the eye's
               * focal point of the frame, so it should sit in the middle
               * of its column instead of hugging the top-left corner. */}
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto p-3">
                <BarChart
                  step={step}
                  algorithm={algorithm}
                  size={showTreePanel ? 'pres-small' : 'pres-large'}
                />
                {/* Aux buffer: always visible for mergesort so the reader
                 * can see "how much extra memory this needs" between
                 * frames — not just during merge-take. Empty slots
                 * reserve the space so the layout does not jump when a
                 * merge starts. */}
                {algorithm === 'merge' ? (
                  <AuxRail
                    rail={
                      step.auxRail ??
                      (Array.from({ length: values.length }, () => null) as (number | null)[])
                    }
                  />
                ) : null}
              </div>
            </div>
          </div>
          {showTreePanel && treeAlgo ? (
            <div className={`${columnCard} flex-1`}>
              <PanelLabel
                index={showCode ? 3 : 2}
                label="árbol"
                hint={`${treeAlgo} · ${values.length} elementos`}
              />
              {/* Full-width bottom row for the tree — the whole viewport
               * fits a mergesort/quicksort of 8 chips at text-sm without
               * cropping. Overflow-auto kept as a safety net; min-w-max
               * on the inner wrapper guarantees the scroll fires if a
               * bigger example ever exceeds even the full width. */}
              <div className="min-h-0 flex-1 overflow-auto p-3">
                <div className="flex min-h-full min-w-max items-center justify-center">
                  <DivideCombineTree
                    recipe={treeAlgo}
                    values={values}
                    highlightNode={step.callNode}
                    nodeAnnotations={
                      step.callNode !== undefined && step.callAnnotation !== undefined
                        ? { [step.callNode]: step.callAnnotation }
                        : undefined
                    }
                    activeStack={step.callStack}
                    doneNodes={step.doneNodes}
                    chipSize="sm"
                    bare
                  />
                </div>
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
              <BarChart step={step} algorithm={algorithm} size="book" />
              {algorithm === 'merge' ? (
                <AuxRail
                  rail={
                    step.auxRail ??
                    (Array.from({ length: values.length }, () => null) as (number | null)[])
                  }
                />
              ) : null}
            </div>
            {showTreePanel && treeAlgo ? (
              // Book-mode tree: with the bigger chips (text-sm + px-3
              // py-1.5) the mergesort/quicksort tree of 8 elements is
              // wider than the book column, so we pan horizontally
              // rather than crop at the sides.
              <div className="min-w-0 overflow-x-auto">
                <DivideCombineTree
                  recipe={treeAlgo}
                  values={values}
                  highlightNode={step.callNode}
                  nodeAnnotations={
                    step.callNode !== undefined && step.callAnnotation !== undefined
                      ? { [step.callNode]: step.callAnnotation }
                      : undefined
                  }
                  activeStack={step.callStack}
                  doneNodes={step.doneNodes}
                  bare
                />
              </div>
            ) : null}
          </div>
        </>
      )}

      {/* Narration strip — the current frame in plain Spanish, prefaced by
       * a turquoise "qué está pasando" badge (pedagogical anchor: a verbal
       * frame every reader can hold onto while scanning the visual). */}
      <div className="flex items-center gap-3 border-t border-rule bg-sunk px-3 py-2">
        <span className="rounded border border-focus/40 bg-focus/10 px-2 py-0.5 font-mono text-3xs font-bold tracking-wide text-focus uppercase whitespace-nowrap">
          qué está pasando
        </span>
        <p className="m-0 font-mono text-xs text-ink">{step.description}</p>
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
        <label className="ml-1 inline-flex items-center gap-1 rounded border border-rule bg-surface px-2 py-1 text-xs text-ink">
          <span className="font-mono text-3xs text-ink-faint uppercase tracking-wide">
            velocidad
          </span>
          <select
            value={liveSpeed}
            onChange={(e) => setLiveSpeed(e.target.value as 'slow' | 'normal' | 'fast')}
            className="bg-transparent outline-none text-xs text-ink"
            aria-label="Velocidad de reproducción"
          >
            <option value="slow">lenta</option>
            <option value="normal">normal</option>
            <option value="fast">rápida</option>
          </select>
        </label>
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
  /** Sizing bucket for the bar chart:
   *  - `book`: the widget shares a page (natural width, small bars).
   *  - `pres-small`: presentation with tree panel below (bars share the
   *    top row with the code panel, so they stay compact).
   *  - `pres-large`: presentation, no tree — the array IS the entire
   *    right-hand panel and can afford much bigger bars. */
  size?: 'book' | 'pres-small' | 'pres-large';
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
function BarChart({ step, algorithm, size = 'book' }: BarChartProps) {
  const max = Math.max(...step.array);
  const activeSet = new Set(step.active);
  const inSubarray = (i: number) =>
    step.subarray === undefined || (i >= step.subarray[0] && i <= step.subarray[1]);
  const pointers = pointersForFrame(step, algorithm);
  const carry = step.carry;
  // Column width per size bucket — pres-large gets chunkier bars so the
  // n² sorts (which own the whole array panel) do not read as a row of
  // tiny sticks in a huge white space.
  const barCol = size === 'pres-large' ? '3rem' : size === 'pres-small' ? '1.5rem' : '1.75rem';

  return (
    <div className="flex flex-col gap-1">
      {/* Carry row — the value held OUTSIDE the array (insertion sort's `v`).
       * When there's no carry, the row is invisible but keeps its height so
       * the bar row does not jump between frames. */}
      <div className="flex min-w-fit gap-1" aria-label="carta">
        {step.array.map((_, i) => (
          <div key={i} className="flex justify-center" style={{ width: barCol }}>
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
        style={{
          height: size === 'pres-large' ? '22rem' : size === 'pres-small' ? '9.5rem' : '9rem',
        }}
      >
        {step.array.map((v, i) => {
          const isActive = activeSet.has(i);
          const isPivot = step.pivot === i;
          const isSortedPrefix = step.sortedPrefix !== undefined && i < step.sortedPrefix;
          const isSortedSuffix =
            step.sortedSuffix !== undefined && i >= step.array.length - step.sortedSuffix;
          // Indices whose FINAL sorted position has been established
          // (quicksort's `partition-done` moment). Once set, an index
          // stays sorted forever — subsequent recursions never touch it
          // — so the green state OVERRIDES every other state (including
          // out-of-subarray and pivot/active flashes on the very frame
          // the pivot lands home). See sortStepperTrace §annotateCallStack.
          const isSortedIndex = step.sortedIndices?.includes(i) ?? false;
          const isOutOfSubarray = !inSubarray(i);
          const barClass = isSortedIndex
            ? 'border-keep bg-keep-soft text-ink'
            : isOutOfSubarray
              ? 'border-rule bg-sunk text-ink-faint opacity-50'
              : isPivot
                ? 'border-accent-pop bg-accent-pop text-surface'
                : isActive
                  ? 'border-accent-pop bg-accent-soft text-ink'
                  : isSortedPrefix || isSortedSuffix
                    ? 'border-keep bg-keep-soft text-ink'
                    : 'border-accent bg-surface text-ink';
          // 20 % baseline + 80 % proportional — keeps the ratio monotonic
          // (smaller values stay smaller) while giving the "1" bar enough
          // vertical room that the value label reads above the border,
          // not on top of it.
          const heightPct = 20 + (v / Math.max(1, max)) * 80;
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
            <div key={i} className="flex h-full flex-col justify-end" style={{ width: barCol }}>
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
            style={{ width: barCol }}
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
            <div key={i} className="flex justify-center gap-0.5" style={{ width: barCol }}>
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
  // Short label ("p" not "pivot") so the badge fits inside the narrow bar
  // column — the legend at the bottom of the widget still spells "pivot".
  if (step.pivot !== undefined) push(step.pivot, 'p');
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
  if (label === 'p') return 'border-accent-pop bg-accent-pop text-surface';
  if (label === 'min') return 'border-keep bg-keep-soft text-ink';
  if (label === 'v→') return 'border-accent-pop bg-accent-soft text-accent';
  return 'border-accent bg-accent-soft text-accent';
}

// ── Aux rail (merge) ─────────────────────────────────────────────────────

function AuxRail({ rail }: { rail: (number | null)[] }) {
  return (
    <div className="flex flex-col gap-1 border-t border-dashed border-rule pt-3">
      <span className="font-mono text-3xs tracking-wide text-ink-faint uppercase">
        buffer aux · destino
      </span>
      <div className="flex min-w-fit gap-1" role="row" aria-label="buffer auxiliar">
        {rail.map((v, i) => (
          <div
            key={i}
            data-aux-index={i}
            data-aux-value={v ?? ''}
            className={`inline-flex h-8 items-center justify-center rounded border font-mono text-sm ${
              v === null
                ? 'border-dashed border-rule bg-sunk text-ink-faint'
                : 'border-keep bg-keep-soft font-semibold text-ink'
            }`}
            style={{ width: '2.75rem' }}
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

/** Numbered panel header used in presentation mode. The filled orange badge
 * makes the reader's scanning order explicit: 1 (código) → 2 (arreglo) → 3
 * (árbol). An optional `hint` (right-aligned) names the sub-context of the
 * panel — the active code line, the current merge / partition annotation,
 * the tree's algorithm + size. */
function PanelLabel({ index, label, hint }: { index: number; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-rule bg-sunk px-3 py-1.5 font-mono text-3xs uppercase tracking-wide text-ink-faint">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-accent font-bold text-on-accent">
        {index}
      </span>
      <span className="font-bold text-ink-soft">{label}</span>
      {hint ? (
        <span className="ml-auto normal-case tracking-normal text-ink-faint truncate">{hint}</span>
      ) : null}
    </div>
  );
}

/** Human-readable name of the algorithm — used in the header badge so the
 * reader identifies the algorithm at a glance ("MERGESORT" beats "merge"). */
function fullAlgorithmName(algorithm: SortAlgorithm): string {
  switch (algorithm) {
    case 'bubble':
      return 'bubble sort';
    case 'selection':
      return 'selection sort';
    case 'insertion':
      return 'insertion sort';
    case 'merge':
      return 'mergesort';
    case 'quick':
      return 'quicksort';
  }
}

/** Compact sub-context for the arreglo panel header. Uses the step's
 * `callAnnotation` when the algorithm frames it (merge, quick); otherwise
 * a short phase label. */
function arrayHint(step: SortStep, algorithm: SortAlgorithm): string {
  if (step.callAnnotation) return step.callAnnotation;
  switch (step.kind) {
    case 'compare':
      return 'comparando';
    case 'swap':
      return 'intercambiando';
    case 'shift':
      return 'corriendo';
    case 'insert':
      return 'insertando v';
    case 'select-min':
      return algorithm === 'insertion'
        ? 'tomando la carta'
        : algorithm === 'quick'
          ? 'eligiendo pivot'
          : 'buscando el mínimo';
    case 'partition-scan':
      return 'particionando';
    case 'partition-done':
      return 'partición lista';
    case 'merge-take':
      return 'combinando';
    case 'merge-done':
      return 'merge listo';
    case 'enter':
      return 'entrando en la llamada';
    case 'return':
      return 'retornando';
    case 'done':
      return 'listo';
  }
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
