import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useMode } from '../../presentation';
import { CodeStepper } from './CodeStepper';
import { lomutoPartition } from './sortStepperTrace';
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

export interface PartitionStepperProps {
  /**
   * Input array to partition. Default `[5, 3, 8, 1, 9, 2, 7]` — the pivot
   * is `a[0] = 5`, giving a balanced split for the reader's first pass.
   */
  input?: number[];
  /** Optional widget title shown in the header. */
  title?: string;
  /** Autoplay on mount. Default `false` (rule Peli 1/2). */
  autoplay?: boolean;
  /** Playback speed. Default `normal`. */
  speed?: StepSpeed;
}

interface Snapshot {
  line: number;
  /** Array snapshot AFTER this step's effect. */
  a: number[];
  /** Pivot's value — constant across the whole trace. */
  pivot: number;
  /** Pivot's current index (moves once when it is parked at the end, and
   * once again when it is placed at `store` at the end). */
  pivotIndex: number;
  /** Store pointer: the boundary of the "known smaller" region. */
  store: number;
  /** Scan pointer `j`, or `null` before the loop starts / after it ends. */
  scan: number | null;
  /** True while the pivot lives at the right border (aparcado). Used to
   * paint the pivot with the same emphatic style regardless of index. */
  pivotParked: boolean;
  caption: string;
  /** Optional short label for the array-panel header hint. */
  hint?: string;
}

const CODE = `static int partition(int[] a, int lo, int hi) {
    int pivot = a[lo];
    swap(a, lo, hi);
    int store = lo;
    for (int j = lo; j < hi; j++) {
        if (a[j] < pivot) { swap(a, store, j); store++; }
    }
    swap(a, store, hi);
    return store;
}`;

/**
 * Step-by-step visualization of the `partition` operation — the linear-time
 * routine that reorganises an array around a pivot: everything smaller to
 * the left, everything else to the right. This is the OPERATION, not
 * quicksort: no recursion, no tree, just one pass with two pointers.
 *
 * Design shares the `<SortStepper>` shell (ADR-0065) via `stepperShell`:
 * accent chip + title + big step counter + progress bar in the header;
 * numbered panels (1 código, 2 arreglo); a "qué está pasando" narration
 * strip in turquoise; the same control row. Presentation lays out code |
 * array side by side and breaks out to 75 % of the viewport; book stacks
 * vertically. Playback pauses when the widget scrolls out of view.
 *
 * Uses the Lomuto scheme with pivot = a[0] parked at the end — the exact
 * same partition `<SortStepper algorithm="quick">` runs (via the shared
 * `lomutoPartition` in `sortStepperTrace`), so a reader moving from this
 * widget to the full quicksort widget sees consistent behaviour, not two
 * conflicting stories.
 *
 * Pedagogical point (Sedgewick, mirror of the mergesort move): if this
 * operation is linear, the recursion on top gives you quicksort in
 * Θ(N log N) on average. Teaching partition first, in isolation, lets the
 * reader see where ALL of quicksort's work lives.
 */
export function PartitionStepper({
  input = [5, 3, 8, 1, 9, 2, 7],
  title,
  autoplay = false,
  speed = 'normal',
}: PartitionStepperProps) {
  const mode = useMode();
  const isPresentation = mode === 'presentation';
  const resetKey = input.join(',');

  const snapshots = useMemo(() => buildTrace(input), [resetKey]);
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
  const heading = title ?? 'Partition (Lomuto) · operación aislada';

  const codePanel = (
    <div className="min-h-0 flex-1 overflow-hidden bg-surface [&>div]:!h-full [&_.cm-theme-light]:!h-full [&_.cm-theme-dark]:!h-full [&_.cm-editor]:!h-full [&_.cm-scroller]:!h-full [&_.cm-content]:!min-h-full">
      <CodeStepper code={CODE} highlightLines={[snap.line]} language="java" />
    </div>
  );

  const arrayPanel = (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-auto p-4">
      <ArrayRow snap={snap} />
      <PointerLegend snap={snap} />
    </div>
  );

  const columnCard = 'flex min-w-0 min-h-0 flex-col rounded border border-rule bg-surface';

  return (
    <figure
      ref={outerRef}
      data-widget="partition-stepper"
      data-mode={mode}
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <StepperHeader
        kind="op · partition (Lomuto)"
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
            <PanelLabel index={2} label="arreglo" hint={snap.hint ?? 'particionando'} />
            {arrayPanel}
          </div>
        </div>
      ) : (
        <>
          <div className="border-b border-rule">
            <CodeStepper code={CODE} highlightLines={[snap.line]} language="java" />
          </div>
          {arrayPanel}
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
          <LegendSwatch swatchClass="border-accent-pop bg-accent-pop" label="pivot" />
          <LegendSwatch swatchClass="border-accent-pop bg-accent-soft" label="j (activo)" />
          <LegendSwatch swatchClass="border-keep bg-keep-soft" label="< pivot" />
          <LegendSwatch swatchClass="border-accent bg-surface" label="sin clasificar" />
        </div>
      </div>
    </figure>
  );
}

function ArrayRow({ snap }: { snap: Snapshot }) {
  return (
    <div className="flex flex-col gap-1" data-testid="partition-array">
      {/* j pointer row */}
      <div className="flex h-5 items-end gap-1.5">
        {snap.a.map((_, idx) => {
          const isScan = idx === snap.scan;
          return (
            <span
              key={idx}
              className={`inline-flex h-5 w-11 items-center justify-center rounded font-mono text-2xs font-bold ${
                isScan ? 'border border-accent-pop bg-accent-soft text-accent' : 'text-transparent'
              }`}
              aria-hidden={!isScan}
            >
              {isScan ? 'j' : '·'}
            </span>
          );
        })}
      </div>
      {/* Cells */}
      <div className="flex gap-1.5">
        {snap.a.map((v, idx) => {
          const isPivot = idx === snap.pivotIndex;
          const isScan = idx === snap.scan;
          const isSmallerBoundary = idx < snap.store; // already placed < pivot
          let cellClass: string;
          if (isPivot) {
            cellClass = 'border-accent-pop bg-accent-pop text-on-accent';
          } else if (isScan) {
            cellClass = 'border-accent-pop bg-accent-soft text-ink ring-2 ring-focus ring-offset-1';
          } else if (isSmallerBoundary) {
            cellClass = 'border-keep bg-keep-soft text-ink';
          } else {
            cellClass = 'border-accent bg-surface text-ink';
          }
          return (
            <span
              key={idx}
              data-testid={`partition-cell-${idx}`}
              data-value={v}
              data-role={
                isPivot ? 'pivot' : isScan ? 'scan' : isSmallerBoundary ? 'placed-smaller' : 'idle'
              }
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
      {/* Store marker row — a "↑ store" chip under the store column */}
      <div className="flex h-5 items-start gap-1.5">
        {snap.a.map((_, idx) => {
          const isStore = idx === snap.store;
          return (
            <span
              key={idx}
              className={`inline-flex h-5 w-11 items-center justify-center rounded font-mono text-2xs font-bold ${
                isStore ? 'border border-focus/60 bg-focus/10 text-focus' : 'text-transparent'
              }`}
              aria-hidden={!isStore}
            >
              {isStore ? '↑store' : '·'}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PointerLegend({ snap }: { snap: Snapshot }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 font-mono text-xs text-ink-soft">
      <span>
        <span className="text-ink-faint">pivot = </span>
        <span className="font-bold text-accent-pop">{snap.pivot}</span>
      </span>
      <span>
        <span className="text-ink-faint">store = </span>
        <span className="font-bold text-focus">{snap.store}</span>
      </span>
      <span>
        <span className="text-ink-faint">j = </span>
        <span className="font-bold text-focus">{snap.scan === null ? '—' : snap.scan}</span>
      </span>
    </div>
  );
}

/**
 * Pure trace of a Lomuto partition over the whole array (`lo=0`, `hi=n-1`,
 * pivot = a[0]). Exposed for the suite so it can pin the shape without
 * touching the DOM.
 */
export function buildTrace(input: number[]): Snapshot[] {
  const events: Snapshot[] = [];
  const a = [...input];
  const lo = 0;
  const hi = a.length - 1;

  if (hi <= lo) {
    events.push({
      line: 1,
      a: [...a],
      pivot: a[0] ?? 0,
      pivotIndex: 0,
      store: 0,
      scan: null,
      pivotParked: false,
      caption: 'Arreglo con 0 o 1 elemento: no hay nada que particionar.',
      hint: 'nada que hacer',
    });
    return events;
  }

  const pivot = a[lo]!;

  events.push({
    line: 2,
    a: [...a],
    pivot,
    pivotIndex: lo,
    store: lo,
    scan: null,
    pivotParked: false,
    caption: `Elegimos el pivot p = a[${lo}] = ${pivot}.`,
    hint: `pivot = ${pivot}`,
  });

  [a[lo], a[hi]] = [a[hi]!, a[lo]!];
  events.push({
    line: 3,
    a: [...a],
    pivot,
    pivotIndex: hi,
    store: lo,
    scan: null,
    pivotParked: true,
    caption: `Aparcamos el pivot al final: swap a[${lo}] ↔ a[${hi}]. Ahora el pivot vive en el borde derecho, fuera de nuestro camino.`,
    hint: 'pivot aparcado',
  });

  let store = lo;
  events.push({
    line: 4,
    a: [...a],
    pivot,
    pivotIndex: hi,
    store,
    scan: null,
    pivotParked: true,
    caption: `Iniciamos store = ${lo}. Todo lo que quede a la izquierda de store será menor que el pivot.`,
    hint: 'store en 0',
  });

  for (let j = lo; j < hi; j += 1) {
    const smaller = a[j]! < pivot;
    events.push({
      line: 6,
      a: [...a],
      pivot,
      pivotIndex: hi,
      store,
      scan: j,
      pivotParked: true,
      caption: smaller
        ? `Comparamos a[${j}] = ${a[j]} < pivot = ${pivot} — sí, va a la izquierda.`
        : `Comparamos a[${j}] = ${a[j]} < pivot = ${pivot} — no, se queda a la derecha.`,
      hint: `comparando a[${j}] vs ${pivot}`,
    });
    if (smaller) {
      if (store !== j) {
        [a[store], a[j]] = [a[j]!, a[store]!];
        events.push({
          line: 6,
          a: [...a],
          pivot,
          pivotIndex: hi,
          store: store + 1,
          scan: j,
          pivotParked: true,
          caption: `Swap a[${store}] ↔ a[${j}] para mandarlo a la izquierda y avanzamos store a ${store + 1}.`,
          hint: `store → ${store + 1}`,
        });
      } else {
        events.push({
          line: 6,
          a: [...a],
          pivot,
          pivotIndex: hi,
          store: store + 1,
          scan: j,
          pivotParked: true,
          caption: `Ya está en su lugar (store == j) — solo avanzamos store a ${store + 1}.`,
          hint: `store → ${store + 1}`,
        });
      }
      store += 1;
    }
  }

  [a[store], a[hi]] = [a[hi]!, a[store]!];
  events.push({
    line: 8,
    a: [...a],
    pivot,
    pivotIndex: store,
    store,
    scan: null,
    pivotParked: false,
    caption: `Traemos el pivot a su lugar final: swap a[${store}] ↔ a[${hi}]. El pivot queda en la posición ${store}.`,
    hint: 'pivot en su casa',
  });

  events.push({
    line: 9,
    a: [...a],
    pivot,
    pivotIndex: store,
    store,
    scan: null,
    pivotParked: false,
    caption: `Devolvemos ${store}. A la izquierda todos son < ${pivot}; a la derecha todos son ≥ ${pivot}. Costo: Θ(N) con N = ${input.length}.`,
    hint: 'listo',
  });

  return events;
}

// Re-export the shared primitive so external callers (widgets, tests) can
// verify our trace lands on the SAME result as the shared Lomuto partition.
export { lomutoPartition };
