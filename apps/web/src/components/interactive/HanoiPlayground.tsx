import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useResolvedTheme } from '../../lib/useResolvedTheme';
import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';

/**
 * The Java source shown in the code panel above the towers. Line
 * numbers are 1-indexed and land as follows:
 *   1: static void hanoi(int n, char from, char to, char aux) {
 *   2:     if (n == 0) return;
 *   3:     hanoi(n - 1, from, aux, to);
 *   4:     System.out.println("Disc " + n + ": " + from + " -> " + to);
 *   5:     hanoi(n - 1, aux, to, from);
 *   6: }
 * The `line` field on each Event names which of those lines just
 * fired to produce the state the widget is now showing.
 */
const HANOI_CODE = `static void hanoi(int n, char from, char to, char aux) {
    if (n == 0) return;
    hanoi(n - 1, from, aux, to);
    System.out.println("Disc " + n + ": " + from + " -> " + to);
    hanoi(n - 1, aux, to, from);
}`;

/**
 * The maximum number of discs the widget will render. hanoi(6) is 63 moves,
 * hanoi(7) is 127 — beyond that a reader loses track. hanoi(4) is the
 * default and reads legibly on a slide (15 moves).
 */
const MAX_DISCS = 6;

/**
 * A single event in the algorithm's execution. `move` events are the
 * observable output of `hanoi(n, from, to, aux)` — one disc physically
 * moves between two towers. `call` and `return` events surface the
 * recursive structure in the side panel, so the reader sees WHICH call is
 * executing when a disc moves.
 */
type Event =
  | { type: 'call'; label: string; depth: number; line: number }
  | { type: 'move'; disc: number; from: TowerId; to: TowerId; depth: number; line: number }
  | { type: 'return'; depth: number; line: number };

type TowerId = 'A' | 'B' | 'C';

type TowerState = Record<TowerId, number[]>;

function initialTowers(nDiscs: number): TowerState {
  const stack: number[] = [];
  for (let i = nDiscs; i >= 1; i--) stack.push(i);
  return { A: stack, B: [], C: [] };
}

function generateEvents(nDiscs: number): Event[] {
  const events: Event[] = [];
  // `callerLine` is the line in the PARENT function that fired to invoke
  // this call — 3 for the first recursive call, 5 for the second, and 1
  // for the root invocation (no parent, so we point at the function's
  // entry line so the reader has SOMETHING lit up).
  const walk = (
    n: number,
    from: TowerId,
    to: TowerId,
    aux: TowerId,
    depth: number,
    callerLine: number,
  ) => {
    events.push({ type: 'call', label: `hanoi(${n}, ${from} → ${to})`, depth, line: callerLine });
    if (n === 0) {
      events.push({ type: 'return', depth, line: 2 });
      return;
    }
    walk(n - 1, from, aux, to, depth + 1, 3);
    events.push({ type: 'move', disc: n, from, to, depth, line: 4 });
    walk(n - 1, aux, to, from, depth + 1, 5);
    events.push({ type: 'return', depth, line: 6 });
  };
  walk(nDiscs, 'A', 'C', 'B', 0, 1);
  return events;
}

/**
 * Replay the event stream up to `step` and return the derived state:
 * - the current tower configuration
 * - the "live" recursive-call chain (indented by depth)
 * - the last move that happened (for optional highlighting)
 */
interface DerivedState {
  towers: TowerState;
  callChain: { label: string; depth: number }[];
  lastMove?: { disc: number; from: TowerId; to: TowerId };
  moveCount: number;
}

function replay(events: Event[], step: number, nDiscs: number): DerivedState {
  const towers = initialTowers(nDiscs);
  const callChain: { label: string; depth: number }[] = [];
  let lastMove: { disc: number; from: TowerId; to: TowerId } | undefined;
  let moveCount = 0;
  for (let i = 0; i < step && i < events.length; i++) {
    const event = events[i]!;
    if (event.type === 'call') {
      callChain.push({ label: event.label, depth: event.depth });
    } else if (event.type === 'return') {
      // Pop the topmost call at this depth or deeper.
      while (callChain.length > 0 && callChain[callChain.length - 1]!.depth >= event.depth) {
        callChain.pop();
      }
    } else {
      // Move: pop from `from`, push to `to`.
      const disc = towers[event.from].pop();
      if (disc !== undefined) towers[event.to].push(disc);
      lastMove = { disc: event.disc, from: event.from, to: event.to };
      moveCount++;
    }
  }
  return { towers, callChain, lastMove, moveCount };
}

export interface HanoiPlaygroundProps {
  /** Number of discs. Integer between 1 and 6 inclusive. Default 4. */
  arg?: number;
  /** Optional title shown in the header. */
  title?: string;
  /** If true, playback starts immediately. Default false. */
  autoplay?: boolean;
  /** Playback speed multiplier (0.5, 1, 2). Default 1. */
  speed?: number;
  /**
   * If false, the side panel with the recursive call is hidden. The visual
   * signal is then only the disc movements. Default true.
   */
  showRecursiveCall?: boolean;
}

/**
 * A widget that animates the Torres de Hanoi algorithm (ADR-0050).
 *
 * Three vertical pegs, colored discs stacked by size on the origin peg,
 * and a side panel showing the recursive call currently executing. Playback
 * is manual by default (Play / Pausa / Paso / Reset controls); the reader
 * drives the walk in class or watches it auto-play.
 *
 * Consumed by Acto 5 slides 5.6 and 5.7 (introduce and solve Hanoi) and
 * indirectly by 5.8 (the algorithmic pattern the counter-example rests on).
 */
export function HanoiPlayground({
  arg = 4,
  title,
  autoplay = false,
  speed = 1,
  showRecursiveCall = true,
}: HanoiPlaygroundProps) {
  const nDiscs = arg;
  const theme = useResolvedTheme();

  const events = useMemo(() => {
    if (!Number.isInteger(nDiscs) || nDiscs < 1 || nDiscs > MAX_DISCS) return null;
    return generateEvents(nDiscs);
  }, [nDiscs]);

  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);

  useEffect(() => {
    setStep(0);
    setIsPlaying(autoplay);
  }, [nDiscs, autoplay]);

  useEffect(() => {
    if (!isPlaying || events === null) return;
    if (step >= events.length) {
      setIsPlaying(false);
      return;
    }
    const delay = 500 / Math.max(0.25, speed);
    const timeout = window.setTimeout(() => setStep((s) => s + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [isPlaying, step, speed, events]);

  const paint = useCallback((disc: number) => paintDisc(theme, disc, nDiscs), [theme, nDiscs]);

  if (!Number.isInteger(nDiscs) || nDiscs < 1) {
    return (
      <AuthoringError component="HanoiPlayground">
        la prop <code>arg</code> tiene que ser un entero ≥ 1.
      </AuthoringError>
    );
  }

  if (nDiscs > MAX_DISCS) {
    return (
      <AuthoringError component="HanoiPlayground">
        {nDiscs} discos es demasiado — el máximo es {MAX_DISCS} ({2 ** MAX_DISCS - 1} movimientos).
        Para números mayores la animación es imposible de seguir; usá{' '}
        <code>&lt;RecursionTree recipe=&quot;hanoi&quot;&gt;</code> para mostrar la estructura del
        árbol.
      </AuthoringError>
    );
  }

  if (events === null) {
    return (
      <AuthoringError component="HanoiPlayground">
        no se pudo generar la secuencia — revisá <code>arg</code>.
      </AuthoringError>
    );
  }

  const clampedStep = Math.min(step, events.length);
  const state = replay(events, clampedStep, nDiscs);
  const totalMoves = 2 ** nDiscs - 1;
  const canStepBack = clampedStep > 0;
  const canStepForward = clampedStep < events.length;
  const atEnd = !canStepForward;
  // Line to highlight in the code panel: the `line` field of the event
  // that just fired to produce the current state. Before any step has
  // fired, no line is highlighted.
  const currentLine = clampedStep > 0 ? events[clampedStep - 1]!.line : undefined;
  const highlightLines = currentLine !== undefined ? [currentLine] : [];

  const towerHeight = MAX_DISCS + 1;

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      <header className="flex flex-wrap items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          torres de hanoi
        </span>
        {title !== undefined && <span className="font-mono text-sm text-ink">{title}</span>}
        <span className="ml-auto font-mono text-3xs text-ink-faint">
          movimiento: {state.moveCount} / {totalMoves}
        </span>
      </header>

      {/* Code panel: source of the recursion, with the line that just
          fired highlighted. Lets the reader connect the physical disc
          movements to the exact line of Java driving them. */}
      <div className="border-t border-rule">
        <CodeStepper code={HANOI_CODE} language="java" highlightLines={highlightLines} />
      </div>

      <div
        className={`grid grid-cols-1 border-t border-rule ${
          showRecursiveCall ? 'md:grid-cols-[1fr_16rem]' : ''
        }`}
      >
        <div
          className="grid grid-cols-3 gap-2 bg-sunk/20 p-4"
          role="img"
          aria-label={`Estado del puzzle: torre A tiene ${state.towers.A.length} discos, torre B tiene ${state.towers.B.length}, torre C tiene ${state.towers.C.length}. ${state.moveCount} movimientos ejecutados.`}
        >
          {(['A', 'B', 'C'] as const).map((towerId) => (
            <Tower
              key={towerId}
              id={towerId}
              discs={state.towers[towerId]}
              maxHeight={towerHeight}
              maxDiscSize={nDiscs}
              paint={paint}
            />
          ))}
        </div>

        {showRecursiveCall && (
          <div className="flex flex-col border-t border-rule bg-sunk/30 p-3 font-mono text-xs md:border-t-0 md:border-l">
            <div className="mb-2 font-semibold uppercase text-3xs tracking-wide text-ink-faint">
              Llamada recursiva
            </div>
            {state.callChain.length === 0 ? (
              <p className="text-ink-faint">Sin llamadas activas.</p>
            ) : (
              <ol className="space-y-1" aria-label="Pila de llamadas recursivas activas">
                {state.callChain.map((entry, i) => {
                  const isTop = i === state.callChain.length - 1;
                  return (
                    <li
                      key={i}
                      style={{ paddingLeft: `${entry.depth * 0.75}rem` }}
                      className={isTop ? 'font-semibold text-accent' : 'text-ink-soft'}
                    >
                      {entry.label}
                    </li>
                  );
                })}
              </ol>
            )}
            {state.lastMove !== undefined && (
              <div className="mt-3 border-t border-rule pt-2 text-3xs text-ink-faint">
                Último movimiento:{' '}
                <span className="font-semibold text-ink">
                  disco {state.lastMove.disc}: {state.lastMove.from} → {state.lastMove.to}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-rule bg-sunk px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => setStep(0)}
          className="rounded border border-rule bg-surface px-2 py-1 text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label="Reset"
        >
          <RotateCcw size={12} />
        </button>
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={!canStepBack}
          className="rounded border border-rule bg-surface px-2 py-1 text-ink-soft hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label="Paso atrás"
        >
          <SkipBack size={12} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (atEnd) return;
            setIsPlaying((p) => !p);
          }}
          disabled={atEnd}
          className="rounded border border-rule bg-surface px-2 py-1 text-ink-soft hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label={isPlaying ? 'Pausa' : 'Play'}
        >
          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button
          type="button"
          onClick={() => setStep((s) => Math.min(events.length, s + 1))}
          disabled={!canStepForward}
          className="rounded border border-rule bg-surface px-2 py-1 text-ink-soft hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label="Paso adelante"
        >
          <SkipForward size={12} />
        </button>
        <span className="ml-auto text-3xs text-ink-faint">
          paso {clampedStep} / {events.length}
        </span>
      </div>
    </div>
  );
}

interface TowerProps {
  id: TowerId;
  discs: number[];
  maxHeight: number;
  maxDiscSize: number;
  paint: (disc: number) => { background: string; border: string; color: string };
}

function Tower({ id, discs, maxHeight, maxDiscSize, paint }: TowerProps) {
  // Render slots top-down (slot 0 = visual top, slot maxHeight-1 = visual base).
  // `discs` is bottom-up (discs[0] = physical base, discs[length-1] = physical top),
  // so we place discs[0] at the bottom slot and walk upward from there.
  const slots: (number | null)[] = new Array(maxHeight).fill(null) as (number | null)[];
  for (let i = 0; i < discs.length; i++) {
    slots[maxHeight - 1 - i] = discs[i]!;
  }
  return (
    <div className="relative flex flex-col items-center" data-testid={`hanoi-tower-${id}`}>
      <div className="relative flex w-full flex-col items-center gap-0.5">
        {slots.map((disc, i) => (
          <div key={i} className="relative flex h-4 w-full items-center justify-center">
            {i === 0 && (
              <div className="pointer-events-none absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-rule" />
            )}
            {disc !== null && (
              <div
                data-testid={`hanoi-disc-${disc}`}
                data-disc-size={disc}
                data-tower={id}
                className="absolute rounded border text-center font-mono text-3xs"
                style={{
                  width: `${(disc / maxDiscSize) * 90 + 10}%`,
                  height: '100%',
                  ...paint(disc),
                }}
              >
                {disc}
              </div>
            )}
            {disc === null && i > 0 && (
              <div className="pointer-events-none absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-rule" />
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 h-1 w-full rounded bg-rule" />
      <div className="mt-1 font-mono text-3xs text-ink-faint">{id}</div>
    </div>
  );
}

/**
 * Colour per disc: cycles through the accent-friendly hue rotation so the
 * reader can track a disc by colour as it moves across towers. The number
 * on the disc is the fallback signal (colour is never the only signal —
 * design-system.md).
 */
function paintDisc(theme: 'light' | 'dark', disc: number, maxDisc: number) {
  const HUE_STEP = 360 / Math.max(1, maxDisc);
  const hue = ((disc - 1) * HUE_STEP) % 360;
  if (theme === 'dark') {
    return {
      background: `hsl(${hue} 40% 32%)`,
      border: `1px solid hsl(${hue} 60% 60%)`,
      color: 'hsl(0 0% 95%)',
    };
  }
  return {
    background: `hsl(${hue} 55% 78%)`,
    border: `1px solid hsl(${hue} 60% 40%)`,
    color: 'hsl(0 0% 12%)',
  };
}
