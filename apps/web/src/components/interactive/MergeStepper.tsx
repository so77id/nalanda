import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useMode } from '../../presentation';
import { CodeStepper } from './CodeStepper';
import {
  ControlButton,
  LegendSwatch,
  NarrationStrip,
  PanelLabel,
  StepperHeader,
  useStepPlayback,
  type StepSpeed,
} from './stepperShell';
import { useViewportBreakout } from './useViewportBreakout';

export interface MergeStepperProps {
  /**
   * Left sorted half. Combined with `right` into the single input array
   * `a = [...left, ...right]` that the widget then merges in place using
   * an aux buffer — EXACTLY the same routine `<SortStepper algorithm="merge">`
   * uses inside mergesort (`sortStepperTrace.ts`), so the reader sees the
   * same code in both places. Must be sorted ascending. Default `[1, 4, 6]`.
   */
  left?: number[];
  /**
   * Right sorted half. Must be sorted ascending. Default `[2, 3, 5, 7]`.
   */
  right?: number[];
  /** Optional widget title shown in the header. */
  title?: string;
  /** Autoplay on mount. Default `false` (rule Peli 1/2). */
  autoplay?: boolean;
  /** Playback speed. Default `normal`. */
  speed?: StepSpeed;
}

interface Snapshot {
  line: number;
  /** Current state of `a` (the target array — gets rewritten as k advances). */
  a: number[];
  /** Current state of `aux` (null slots before the copy step). */
  aux: (number | null)[];
  /** Pointer into aux, left half (`[0..mid]`). */
  i: number | null;
  /** Pointer into aux, right half (`[mid+1..hi]`). */
  j: number | null;
  /** Write pointer into `a`. */
  k: number | null;
  /** Split point in aux: last index of the left half. Constant across the
   * trace; drawn as a visible gap between the two halves. */
  mid: number;
  /** How many cells of `a` have been rewritten so far (`0..n`). Used to
   * paint them green as the invariant "prefix already merged" grows. */
  writtenCount: number;
  caption: string;
  /** Optional short label for the array-panel header hint. */
  hint?: string;
}

const CODE = `static void merge(int[] a, int lo, int mid, int hi) {
    int[] aux = new int[hi - lo + 1];
    for (int k = lo; k <= hi; k++) aux[k - lo] = a[k];
    int i = 0, j = mid - lo + 1;
    for (int k = lo; k <= hi; k++) {
        if      (i > mid - lo)      a[k] = aux[j++];
        else if (j > hi - lo)       a[k] = aux[i++];
        else if (aux[i] <= aux[j])  a[k] = aux[i++];
        else                        a[k] = aux[j++];
    }
}`;

/**
 * Step-by-step visualization of the `merge` operation — the linear-time
 * routine that takes an array `a[lo..hi]` composed of TWO already-sorted
 * halves (`a[lo..mid]` and `a[mid+1..hi]`) and rewrites it in place as one
 * sorted range, using an auxiliary buffer.
 *
 * Displays the EXACT same code the mergesort inside `<SortStepper>` uses
 * (`sortStepperTrace.ts` §mergeArrays) — so when the reader moves from this
 * widget to the full mergesort widget, the merge is recognisable and it
 * really is "just plug in and use". The trace calls it with `lo = 0`,
 * `mid = left.length - 1`, `hi = a.length - 1` — the widget shows the
 * operation over a full array, no sub-range gymnastics.
 *
 * Design shares the `<SortStepper>` shell via `stepperShell`: accent chip +
 * title + big step counter + progress bar in the header; numbered panels;
 * "qué está pasando" narration strip in turquoise; skip / play / reset +
 * speed + legend controls. Presentation grid: 2 columns (code | arreglos)
 * at 75 % of the viewport. Book stacks vertically. Playback pauses when the
 * widget scrolls out of view.
 */
export function MergeStepper({
  left = [1, 4, 6],
  right = [2, 3, 5, 7],
  title,
  autoplay = false,
  speed = 'normal',
}: MergeStepperProps) {
  const mode = useMode();
  const isPresentation = mode === 'presentation';
  const leftKey = left.join(',');
  const rightKey = right.join(',');
  const resetKey = `${leftKey}|${rightKey}`;

  const snapshots = useMemo(() => buildTrace(left, right), [leftKey, rightKey]);
  const totalSteps = snapshots.length;

  const outerRef = useRef<HTMLElement | null>(null);
  const { stepIndex, isPlaying, liveSpeed, setLiveSpeed, advance, rewind, reset, togglePlay } =
    useStepPlayback({
      totalSteps,
      autoplay,
      speed,
      visibilityRef: outerRef,
      resetKey,
    });

  useViewportBreakout(outerRef, {
    enabled: isPresentation,
    fraction: 0.75,
    deps: [resetKey],
  });

  const snap = snapshots[Math.min(stepIndex, totalSteps - 1)]!;
  const heading = title ?? 'Merge · operación aislada';

  const codePanel = (
    <div className="min-h-0 flex-1 overflow-hidden bg-surface [&>div]:!h-full [&_.cm-theme-light]:!h-full [&_.cm-theme-dark]:!h-full [&_.cm-editor]:!h-full [&_.cm-scroller]:!h-full [&_.cm-content]:!min-h-full">
      <CodeStepper code={CODE} highlightLines={[snap.line]} language="java" />
    </div>
  );

  const arraysPanel = (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-auto p-4">
      <ArrayA snap={snap} />
      <AuxRow snap={snap} />
    </div>
  );

  const columnCard = 'flex min-w-0 min-h-0 flex-col rounded border border-rule bg-surface';

  return (
    <figure
      ref={outerRef}
      data-widget="merge-stepper"
      data-mode={mode}
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <StepperHeader
        kind="op · merge"
        title={heading}
        stepIndex={stepIndex}
        totalSteps={totalSteps}
      />

      {isPresentation ? (
        <div
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 px-3 py-3"
          style={{ height: 'min(60vh, 560px)' }}
        >
          <div className={columnCard}>
            <PanelLabel index={1} label="código" hint={`Java · línea ${snap.line}`} />
            {codePanel}
          </div>
          <div className={columnCard}>
            <PanelLabel index={2} label="arreglos" hint={snap.hint ?? 'a + aux'} />
            {arraysPanel}
          </div>
        </div>
      ) : (
        <>
          <div className="border-b border-rule">
            <CodeStepper code={CODE} highlightLines={[snap.line]} language="java" />
          </div>
          {arraysPanel}
        </>
      )}

      <NarrationStrip text={snap.caption} />

      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-sunk px-3 py-1.5">
        <ControlButton onClick={rewind} disabled={stepIndex === 0} label="Paso anterior">
          <SkipBack size={14} aria-hidden />
        </ControlButton>
        <ControlButton
          onClick={advance}
          disabled={stepIndex >= totalSteps - 1}
          label="Paso siguiente"
        >
          <SkipForward size={14} aria-hidden />
        </ControlButton>
        <ControlButton onClick={togglePlay} label={isPlaying ? 'Pausar' : 'Reproducir'}>
          {isPlaying ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        </ControlButton>
        <ControlButton onClick={reset} label="Reiniciar">
          <RotateCcw size={14} aria-hidden />
        </ControlButton>
        <label className="ml-1 inline-flex items-center gap-1 rounded border border-rule bg-surface px-2 py-1 text-xs text-ink">
          <span className="font-mono text-3xs text-ink-faint uppercase tracking-wide">
            velocidad
          </span>
          <select
            value={liveSpeed}
            onChange={(e) => setLiveSpeed(e.target.value as StepSpeed)}
            className="bg-transparent outline-none text-xs text-ink"
            aria-label="Velocidad de reproducción"
          >
            <option value="slow">lenta</option>
            <option value="normal">normal</option>
            <option value="fast">rápida</option>
          </select>
        </label>
        <div className="ml-auto flex items-center gap-3 font-mono text-3xs text-ink-faint">
          <LegendSwatch swatchClass="border-accent bg-surface" label="sin leer / escribir" />
          <LegendSwatch swatchClass="border-accent-pop bg-accent-soft" label="activo (i/j/k)" />
          <LegendSwatch swatchClass="border-keep bg-keep-soft" label="ya merged" />
        </div>
      </div>
    </figure>
  );
}

// ── Row A · the target array that gets rewritten ─────────────────────────
function ArrayA({ snap }: { snap: Snapshot }) {
  return (
    <div className="flex items-start gap-3" data-testid="merge-a">
      <span className="mt-8 w-14 shrink-0 font-mono text-3xs uppercase tracking-wide text-ink-faint">
        a
      </span>
      <div className="flex flex-col gap-1">
        {/* Pointer row */}
        <div className="flex h-5 items-end gap-1.5">
          {snap.a.map((_, idx) => (
            <span
              key={idx}
              className={`inline-flex h-5 w-11 items-center justify-center rounded font-mono text-2xs font-bold ${
                idx === snap.k
                  ? 'border border-accent-pop bg-accent-soft text-accent'
                  : 'text-transparent'
              }`}
              aria-hidden={idx !== snap.k}
            >
              {idx === snap.k ? 'k' : '·'}
            </span>
          ))}
        </div>
        {/* Cells */}
        <div className="flex gap-1.5">
          {snap.a.map((v, idx) => {
            const isWrite = idx === snap.k;
            const isMerged = idx < snap.writtenCount;
            let cellClass: string;
            if (isWrite) {
              cellClass =
                'border-accent-pop bg-accent-soft text-ink ring-2 ring-focus ring-offset-1';
            } else if (isMerged) {
              cellClass = 'border-keep bg-keep-soft text-ink';
            } else {
              cellClass = 'border-accent bg-surface text-ink';
            }
            return (
              <span
                key={idx}
                data-testid={`merge-a-cell-${idx}`}
                data-value={v}
                data-role={isWrite ? 'write' : isMerged ? 'merged' : 'pending'}
                className={`inline-flex h-11 w-11 items-center justify-center rounded border font-mono text-sm font-bold ${cellClass}`}
              >
                {v}
              </span>
            );
          })}
        </div>
        {/* Index row */}
        <div className="flex gap-1.5">
          {snap.a.map((_, idx) => (
            <span
              key={idx}
              className="inline-block w-11 text-center font-mono text-3xs text-ink-faint"
            >
              {idx}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Row aux · the copy split into two halves ─────────────────────────────
function AuxRow({ snap }: { snap: Snapshot }) {
  return (
    <div className="flex items-start gap-3" data-testid="merge-aux">
      <span className="mt-8 w-14 shrink-0 font-mono text-3xs uppercase tracking-wide text-ink-faint">
        aux
      </span>
      <div className="flex flex-col gap-1">
        {/* Pointer row */}
        <div className="flex h-5 items-end gap-1.5">
          {snap.aux.map((_, idx) => {
            const inLeftHalf = idx <= snap.mid;
            const isI = inLeftHalf && idx === snap.i;
            const isJ = !inLeftHalf && idx === snap.j;
            const pointerLabel = isI ? 'i' : isJ ? 'j' : '';
            const gapClass = idx === snap.mid + 1 ? 'ml-3' : '';
            return (
              <span
                key={idx}
                className={`inline-flex h-5 w-11 items-center justify-center rounded font-mono text-2xs font-bold ${
                  isI || isJ
                    ? 'border border-accent-pop bg-accent-soft text-accent'
                    : 'text-transparent'
                } ${gapClass}`}
                aria-hidden={!isI && !isJ}
              >
                {pointerLabel || '·'}
              </span>
            );
          })}
        </div>
        {/* Cells (with a visual gap between the two halves) */}
        <div className="flex gap-1.5">
          {snap.aux.map((v, idx) => {
            const isNull = v === null;
            const inLeftHalf = idx <= snap.mid;
            const isActive = (inLeftHalf && idx === snap.i) || (!inLeftHalf && idx === snap.j);
            const isConsumed = inLeftHalf
              ? snap.i !== null && idx < snap.i
              : snap.j !== null && idx < snap.j;
            let cellClass: string;
            if (isNull) {
              cellClass = 'border-dashed border-rule bg-sunk text-ink-faint';
            } else if (isActive) {
              cellClass =
                'border-accent-pop bg-accent-soft text-ink ring-2 ring-focus ring-offset-1';
            } else if (isConsumed) {
              cellClass = 'border-keep bg-keep-soft text-ink opacity-40';
            } else {
              cellClass = 'border-accent bg-surface text-ink';
            }
            const gapClass = idx === snap.mid + 1 ? 'ml-3' : '';
            return (
              <span
                key={idx}
                data-testid={`merge-aux-cell-${idx}`}
                data-value={v ?? ''}
                data-role={
                  isNull
                    ? 'empty'
                    : isActive
                      ? 'active'
                      : isConsumed
                        ? 'consumed'
                        : inLeftHalf
                          ? 'left'
                          : 'right'
                }
                className={`inline-flex h-11 w-11 items-center justify-center rounded border font-mono text-sm font-bold ${cellClass} ${gapClass}`}
              >
                {isNull ? '·' : v}
              </span>
            );
          })}
        </div>
        {/* Half-label row: "izq" / "der" beneath each half */}
        <div className="flex gap-1.5 pt-1">
          {snap.aux.map((_, idx) => {
            const gapClass = idx === snap.mid + 1 ? 'ml-3' : '';
            let label = '';
            // Centre the label under each half — put it under the middle cell
            // of the half. For odd sizes that's exact; for even, it lands one
            // to the left of centre, which reads fine.
            const leftMid = Math.floor(snap.mid / 2);
            const rightSize = snap.aux.length - (snap.mid + 1);
            const rightMid = snap.mid + 1 + Math.floor(rightSize / 2);
            if (idx === leftMid) label = 'izq';
            else if (idx === rightMid) label = 'der';
            return (
              <span
                key={idx}
                className={`inline-block w-11 text-center font-mono text-3xs uppercase tracking-wide text-ink-faint ${gapClass}`}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Pure trace of the `merge` operation as `<SortStepper>`'s mergesort runs
 * it — the mergeArrays routine in `sortStepperTrace.ts`. Uses `lo = 0`,
 * `mid = left.length - 1`, `hi = a.length - 1`. Exposed for the suite so
 * it can pin the shape without touching the DOM.
 */
export function buildTrace(left: number[], right: number[]): Snapshot[] {
  const events: Snapshot[] = [];
  const initialA = [...left, ...right];
  const n = initialA.length;
  const mid = left.length - 1;
  const lo = 0;
  const hi = n - 1;

  const emptyAux = (): (number | null)[] => Array.from({ length: n }, () => null);
  const a = [...initialA];
  let aux: (number | null)[] = emptyAux();

  // Line 2: reserve the aux buffer (still empty).
  events.push({
    line: 2,
    a: [...a],
    aux: [...aux],
    i: null,
    j: null,
    k: null,
    mid,
    writtenCount: 0,
    caption: `Reservamos un buffer aux de tamaño ${n}. Con lo = ${lo} y hi = ${hi}, cubrimos el arreglo completo — mid = ${mid} separa las dos mitades ya ordenadas.`,
    hint: `aux reservado (${n})`,
  });

  // Line 3: copy a into aux (single step — atomic in the reader's head).
  aux = [...initialA];
  events.push({
    line: 3,
    a: [...a],
    aux: [...aux],
    i: null,
    j: null,
    k: null,
    mid,
    writtenCount: 0,
    caption: `Copiamos a en aux. Ahora las dos mitades ya ordenadas viven en aux, listas para leer, y podemos escribir libremente en a.`,
    hint: 'copia lista',
  });

  // Line 4: init pointers.
  let i = 0;
  let j = mid + 1;
  let k = lo;
  events.push({
    line: 4,
    a: [...a],
    aux: [...aux],
    i,
    j,
    k,
    mid,
    writtenCount: 0,
    caption: `Colocamos los tres punteros: i = ${i} (izq de aux), j = ${j} (der de aux), k = ${k} (donde escribimos en a).`,
    hint: 'punteros iniciados',
  });

  // Main loop.
  while (k <= hi) {
    // Decide which branch of the if-else takes effect this iteration.
    let branchLine: number;
    let takeFromLeft: boolean;
    if (i > mid) {
      branchLine = 6;
      takeFromLeft = false;
    } else if (j > hi) {
      branchLine = 7;
      takeFromLeft = true;
    } else if ((aux[i] as number) <= (aux[j] as number)) {
      branchLine = 8;
      takeFromLeft = true;
    } else {
      branchLine = 9;
      takeFromLeft = false;
    }

    // Comparison / drain frame.
    events.push({
      line: branchLine,
      a: [...a],
      aux: [...aux],
      i,
      j,
      k,
      mid,
      writtenCount: k,
      caption:
        branchLine === 6
          ? `i > mid — la mitad izquierda de aux se agotó. Escribimos lo que queda de la derecha.`
          : branchLine === 7
            ? `j > hi — la mitad derecha de aux se agotó. Escribimos lo que queda de la izquierda.`
            : branchLine === 8
              ? `Comparamos aux[${i}] = ${aux[i]} ≤ aux[${j}] = ${aux[j]} — tomamos el de la izquierda.`
              : `Comparamos aux[${i}] = ${aux[i]} > aux[${j}] = ${aux[j]} — tomamos el de la derecha.`,
      hint: branchLine === 6 || branchLine === 7 ? 'drenando' : `comparando aux[${i}] vs aux[${j}]`,
    });

    // Write frame.
    if (takeFromLeft) {
      const takenIndex = i;
      const takenValue = aux[takenIndex] as number;
      a[k] = takenValue;
      i += 1;
      events.push({
        line: branchLine,
        a: [...a],
        aux: [...aux],
        i,
        j,
        k: k + 1,
        mid,
        writtenCount: k + 1,
        caption: `Escribimos a[${k}] = ${takenValue}, avanzamos i y k.`,
        hint: `escribí ${takenValue} en a[${k}]`,
      });
    } else {
      const takenIndex = j;
      const takenValue = aux[takenIndex] as number;
      a[k] = takenValue;
      j += 1;
      events.push({
        line: branchLine,
        a: [...a],
        aux: [...aux],
        i,
        j,
        k: k + 1,
        mid,
        writtenCount: k + 1,
        caption: `Escribimos a[${k}] = ${takenValue}, avanzamos j y k.`,
        hint: `escribí ${takenValue} en a[${k}]`,
      });
    }
    k += 1;
  }

  // Final frame.
  events.push({
    line: 10,
    a: [...a],
    aux: [...aux],
    i: null,
    j: null,
    k: null,
    mid,
    writtenCount: n,
    caption: `Merge completo: a = [${a.join(', ')}]. Costo total: Θ(N) con N = ${n} — misma rutina que corre mergesort en cada nivel del árbol.`,
    hint: 'listo',
  });

  return events;
}
