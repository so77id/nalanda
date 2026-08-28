import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';

export interface Locals {
  [name: string]: string;
}

export type TraceEvent =
  | {
      type: 'call';
      label: string;
      line: number;
      locals: Locals;
      description: string;
    }
  | {
      type: 'line';
      line: number;
      locals?: Locals;
      description: string;
    }
  | {
      type: 'return';
      returnValue: string;
      description: string;
    };

type Recipe = {
  defaultCode: string;
  language: string;
  trace: (arg: number, maxDepth: number) => { events: TraceEvent[]; overflowedAt?: number };
};

const POWER_BASE = 2;

const RECIPES: Record<string, Recipe> = {
  factorial: {
    language: 'java',
    defaultCode: `static long factorial(int n) {
    if (n == 1) return 1;
    return n * factorial(n - 1);
}`,
    trace: (arg, maxDepth) => traceFactorial(arg, maxDepth),
  },
  sum: {
    language: 'java',
    defaultCode: `static long sum(int n) {
    if (n == 1) return 1;
    return n + sum(n - 1);
}`,
    trace: (arg, maxDepth) => traceSum(arg, maxDepth),
  },
  fib: {
    language: 'java',
    defaultCode: `static long fib(int n) {
    if (n < 2) return n;
    return fib(n - 1) + fib(n - 2);
}`,
    trace: (arg, maxDepth) => traceFib(arg, maxDepth),
  },
  hanoi: {
    language: 'java',
    defaultCode: `static void hanoi(int n, char from, char to, char aux) {
    if (n == 0) return;
    hanoi(n - 1, from, aux, to);
    System.out.println("Disc " + n + ": " + from + " -> " + to);
    hanoi(n - 1, aux, to, from);
}`,
    trace: (arg, maxDepth) => traceHanoi(arg, maxDepth),
  },
  power: {
    language: 'java',
    defaultCode: `static long power(long x, int e) {
    if (e == 0) return 1;
    long half = power(x, e / 2);
    if (e % 2 == 0) return half * half;
    return x * half * half;
}`,
    trace: (arg, maxDepth) => tracePower(arg, maxDepth),
  },
  broken: {
    language: 'java',
    defaultCode: `// Recursion without a base case: never terminates.
static long broken(int n) {
    return 1 + broken(n - 1);
}`,
    trace: (arg, maxDepth) => traceBroken(arg, maxDepth),
  },
};

const MAX_TRACE_LENGTH = 3000;
// 20 pushes before the runtime gives up on the broken recipe — the
// deck talks about "20 llamadas y se llega al overflow", so the demo
// has to land there.
const BROKEN_DEFAULT_DEPTH = 20;

export interface CallStackProps {
  recipe?: string;
  arg?: number;
  maxDepth?: number;
  language?: string;
  code?: string;
  title?: string;
  autoplay?: boolean;
  speed?: number;
}

/**
 * A widget that makes the JVM call stack visible during a recursive
 * execution (ADR-0054 · v4 layout 2026-08-27).
 *
 * Layout (two columns, transversal): the left column (~75%) is split
 * vertically — code on top, current context below. The right column
 * (~25%) is the paused-stack column, running the full height of the
 * left side. All paused frames render there (newest anchored at the
 * top); the column has its own scroll and the outer widget never
 * grows to fit the stack. A footer legend captions each event.
 */
export function CallStack({
  recipe,
  arg,
  maxDepth = 0,
  language,
  code,
  title,
  autoplay = false,
  speed = 1,
}: CallStackProps) {
  const known = recipe === undefined ? undefined : RECIPES[recipe];

  const traceResult = useMemo(() => {
    if (known === undefined || arg === undefined) return null;
    if (!Number.isInteger(arg) || arg < 0) return null;
    const effectiveDepth = recipe === 'broken' && maxDepth === 0 ? BROKEN_DEFAULT_DEPTH : maxDepth;
    return known.trace(arg, effectiveDepth);
  }, [known, recipe, arg, maxDepth]);

  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);

  useEffect(() => {
    setStep(0);
    setIsPlaying(autoplay);
  }, [recipe, arg, maxDepth, autoplay]);

  useEffect(() => {
    if (!isPlaying || traceResult === null) return;
    if (step >= traceResult.events.length) {
      setIsPlaying(false);
      return;
    }
    const delay = 900 / Math.max(0.25, speed);
    const timeout = window.setTimeout(() => setStep((s) => s + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [isPlaying, step, speed, traceResult]);

  if (recipe === undefined || known === undefined) {
    return (
      <AuthoringError component="CallStack">
        {recipe === undefined ? (
          <>
            falta la prop <code>recipe</code>. Recetas conocidas: {Object.keys(RECIPES).join(', ')}.
          </>
        ) : (
          <>
            «{recipe}» no es una receta conocida. Hoy hay: {Object.keys(RECIPES).join(', ')}.
          </>
        )}
      </AuthoringError>
    );
  }

  if (arg === undefined || !Number.isInteger(arg) || arg < 0) {
    return (
      <AuthoringError component="CallStack">
        la prop <code>arg</code> tiene que ser un entero no negativo.
      </AuthoringError>
    );
  }

  if (traceResult === null || traceResult.events.length > MAX_TRACE_LENGTH) {
    return (
      <AuthoringError component="CallStack">
        la traza de {recipe}({arg}) supera el límite de {MAX_TRACE_LENGTH} eventos. Reducí{' '}
        <code>arg</code> o mostrá la explosión con <code>&lt;RecursionTree&gt;</code>.
      </AuthoringError>
    );
  }

  const willOverflow = traceResult.overflowedAt !== undefined;
  const clampedStep = Math.min(step, traceResult.events.length);
  const state = replay(traceResult.events, clampedStep);
  const currentEventLabel = clampedStep > 0 ? traceResult.events[clampedStep - 1]!.description : '';

  const canStepBack = clampedStep > 0;
  const canStepForward = clampedStep < traceResult.events.length;
  const atEnd = !canStepForward;
  // The red StackOverflowError signalling — banner, header chip,
  // current-frame variant — only fires once the reader has stepped
  // all the way through the trace and the overflow event actually
  // lands. Before then the widget behaves as a normal execution.
  const overflowed = willOverflow && atEnd;

  const currentFrame = state.frames.length > 0 ? state.frames[state.frames.length - 1]! : null;
  const pausedFrames = state.frames.slice(0, -1);
  const highlightLines = currentFrame !== null ? [currentFrame.line] : [];

  // Newest paused frame goes at the top of the stack column so it is
  // always visible; older frames scroll off the bottom. The stack
  // column has its own scroll (see markup below), so we simply render
  // every paused frame — the container never grows.
  const stackFrames = [...pausedFrames].reverse();

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      <header className="flex flex-wrap items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          call stack
        </span>
        {title !== undefined && <span className="font-mono text-sm text-ink">{title}</span>}
        <span className="ml-auto font-mono text-3xs text-ink-faint">
          {overflowed ? (
            <span className="text-flag">StackOverflowError</span>
          ) : (
            `profundidad: ${state.frames.length}`
          )}
        </span>
      </header>

      {/*
       * Two-column body — the left column drives the widget's height,
       * the right column stretches to that height and scrolls
       * internally. In flexbox row layout with align-items: stretch
       * (default), an item with `overflow: hidden` and its content
       * positioned absolutely does not push the row taller — the
       * container sizes to the left column, and the right column
       * stretches into the space that leaves.
       */}
      <div className="flex flex-col border-t border-rule md:flex-row">
        {/* Left column · code on top, current context below. */}
        <div className="flex flex-col md:basis-3/4 md:min-w-0">
          <CodeStepper
            code={code ?? known.defaultCode}
            language={language ?? known.language}
            highlightLines={highlightLines}
          />
          <div className="flex min-h-[9rem] flex-1 flex-col border-t border-rule bg-sunk/20 p-3">
            <div className="mb-2 font-mono text-3xs uppercase tracking-wide text-ink-faint">
              Contexto actual
            </div>
            <div className="flex flex-1 items-center">
              {currentFrame === null ? (
                <p className="w-full text-center font-mono text-xs text-ink-faint">
                  Stack vacío — click en <span className="font-semibold">Paso</span> para arrancar.
                </p>
              ) : (
                <div className="w-full">
                  <FrameCard
                    frame={currentFrame}
                    variant={overflowed ? 'overflow' : 'current'}
                    caption="← ejecutando"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column · paused stack, transversal to code+context. */}
        <div className="relative border-t border-rule bg-sunk/30 md:basis-1/4 md:border-t-0 md:border-l md:overflow-hidden">
          <div className="flex flex-col p-3 md:absolute md:inset-0">
            <div className="mb-2 font-mono text-3xs uppercase tracking-wide text-ink-faint">
              Stack
            </div>
            <div
              className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1 md:min-h-0"
              role="list"
              aria-label="Frames pausados en el stack (cima arriba)"
              data-testid="callstack-stack-scroll"
            >
              {stackFrames.length === 0 ? (
                <p
                  className="text-center font-mono text-3xs text-ink-faint"
                  data-testid="callstack-stack-empty"
                >
                  vacío
                </p>
              ) : (
                stackFrames.map((frame, i) => (
                  <FrameCard
                    key={`frame-${i}`}
                    frame={frame}
                    variant="paused"
                    caption={`pausada en L${frame.line}`}
                    compact
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {overflowed && (
        <div className="border-t border-rule bg-flag-soft px-3 py-2 text-xs text-flag">
          <strong>StackOverflowError</strong> · el stack alcanzó la profundidad{' '}
          {traceResult.overflowedAt}. La recursión no encontró un caso base — o el problema es más
          profundo que el stack disponible.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-sunk px-3 py-2 text-xs">
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
          onClick={() => setStep((s) => Math.min(traceResult.events.length, s + 1))}
          disabled={!canStepForward}
          className="rounded border border-rule bg-surface px-2 py-1 text-ink-soft hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label="Paso adelante"
        >
          <SkipForward size={12} />
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-3xs text-ink-soft">
          {currentEventLabel && `«${currentEventLabel}»`}
        </span>
        <span className="text-3xs text-ink-faint">
          paso {clampedStep} / {traceResult.events.length}
        </span>
      </div>
    </div>
  );
}

interface Frame {
  label: string;
  line: number;
  locals: Locals;
}

interface State {
  frames: Frame[];
}

function replay(events: TraceEvent[], step: number): State {
  const frames: Frame[] = [];
  for (let i = 0; i < step && i < events.length; i++) {
    const event = events[i]!;
    if (event.type === 'call') {
      frames.push({ label: event.label, line: event.line, locals: { ...event.locals } });
    } else if (event.type === 'return') {
      frames.pop();
    } else {
      const top = frames[frames.length - 1];
      if (top) {
        top.line = event.line;
        if (event.locals) top.locals = { ...top.locals, ...event.locals };
      }
    }
  }
  return { frames };
}

interface FrameCardProps {
  frame: Frame;
  variant: 'current' | 'paused' | 'overflow';
  caption?: string;
  compact?: boolean;
}

function FrameCard({ frame, variant, caption, compact = false }: FrameCardProps) {
  const border =
    variant === 'current'
      ? 'border-2 border-dashed border-accent bg-surface'
      : variant === 'overflow'
        ? 'border-2 border-dashed border-flag bg-flag-soft animate-pulse'
        : 'border border-rule bg-surface';
  const testId = `callstack-frame-${variant}`;
  const localEntries = Object.entries(frame.locals);
  return (
    <div data-testid={testId} role="listitem" className={`rounded p-2 font-mono text-xs ${border}`}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-semibold text-ink">
          <span className="text-ink-faint">Frame:</span> {frame.label}
        </span>
      </div>
      {localEntries.length > 0 && (
        <div className={`rounded bg-sunk/40 px-2 py-1 ${compact ? 'text-3xs' : 'text-xs'}`}>
          {!compact && (
            <div className="mb-0.5 font-mono text-3xs uppercase tracking-wide text-ink-faint">
              Variables
            </div>
          )}
          {localEntries.map(([name, value]) => (
            <div key={name} className="flex items-baseline justify-between gap-2">
              <span className="text-ink-soft">{name}</span>
              <span className="text-ink">= {value}</span>
            </div>
          ))}
        </div>
      )}
      {caption !== undefined && <div className="mt-1 text-3xs text-ink-faint">{caption}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Recipe trace generators.
// ---------------------------------------------------------------------

function traceFactorial(
  arg: number,
  maxDepth: number,
): { events: TraceEvent[]; overflowedAt?: number } {
  const events: TraceEvent[] = [];
  const walk = (n: number, depth: number): { overflow?: number; value?: number } => {
    if (maxDepth > 0 && depth > maxDepth) return { overflow: depth };
    const label = `factorial(${n})`;
    events.push({
      type: 'call',
      label,
      line: 1,
      locals: { n: String(n), return: '?' },
      description: `invocando ${label}`,
    });
    events.push({
      type: 'line',
      line: 2,
      description: `${label} — revisando caso base`,
    });
    if (n <= 1) {
      events.push({
        type: 'return',
        returnValue: '1',
        description: `${label} — caso base, return 1`,
      });
      return { value: 1 };
    }
    events.push({
      type: 'line',
      line: 3,
      description: `${label} — llamando factorial(${n - 1})`,
    });
    const sub = walk(n - 1, depth + 1);
    if (sub.overflow !== undefined) return sub;
    const value = n * sub.value!;
    events.push({
      type: 'line',
      line: 3,
      locals: { return: String(value) },
      description: `${label} — resolviendo ${n} × ${sub.value!} = ${value}`,
    });
    events.push({
      type: 'return',
      returnValue: String(value),
      description: `${label} — return ${value}`,
    });
    return { value };
  };
  const result = walk(arg, 1);
  if (result.overflow !== undefined) return { events, overflowedAt: result.overflow };
  return { events };
}

function traceSum(arg: number, maxDepth: number): { events: TraceEvent[]; overflowedAt?: number } {
  const events: TraceEvent[] = [];
  const walk = (n: number, depth: number): { overflow?: number; value?: number } => {
    if (maxDepth > 0 && depth > maxDepth) return { overflow: depth };
    const label = `sum(${n})`;
    events.push({
      type: 'call',
      label,
      line: 1,
      locals: { n: String(n), return: '?' },
      description: `invocando ${label}`,
    });
    events.push({
      type: 'line',
      line: 2,
      description: `${label} — revisando caso base`,
    });
    if (n <= 1) {
      events.push({
        type: 'return',
        returnValue: '1',
        description: `${label} — caso base, return 1`,
      });
      return { value: 1 };
    }
    events.push({
      type: 'line',
      line: 3,
      description: `${label} — llamando sum(${n - 1})`,
    });
    const sub = walk(n - 1, depth + 1);
    if (sub.overflow !== undefined) return sub;
    const value = n + sub.value!;
    events.push({
      type: 'line',
      line: 3,
      locals: { return: String(value) },
      description: `${label} — resolviendo ${n} + ${sub.value!} = ${value}`,
    });
    events.push({
      type: 'return',
      returnValue: String(value),
      description: `${label} — return ${value}`,
    });
    return { value };
  };
  const result = walk(arg, 1);
  if (result.overflow !== undefined) return { events, overflowedAt: result.overflow };
  return { events };
}

function traceFib(arg: number, maxDepth: number): { events: TraceEvent[]; overflowedAt?: number } {
  const events: TraceEvent[] = [];
  let overflowed: number | undefined;
  const walk = (n: number, depth: number): number => {
    if (overflowed !== undefined) return 0;
    if (maxDepth > 0 && depth > maxDepth) {
      overflowed = depth;
      return 0;
    }
    const label = `fib(${n})`;
    events.push({
      type: 'call',
      label,
      line: 1,
      locals: { n: String(n), return: '?' },
      description: `invocando ${label}`,
    });
    if (n < 2) {
      events.push({
        type: 'return',
        returnValue: String(n),
        description: `${label} — caso base, return ${n}`,
      });
      return n;
    }
    events.push({
      type: 'line',
      line: 3,
      description: `${label} — llamando fib(${n - 1})`,
    });
    const a = walk(n - 1, depth + 1);
    if (overflowed !== undefined) return 0;
    events.push({
      type: 'line',
      line: 3,
      locals: { a: String(a) },
      description: `${label} — llamando fib(${n - 2})`,
    });
    const b = walk(n - 2, depth + 1);
    if (overflowed !== undefined) return 0;
    const value = a + b;
    events.push({
      type: 'line',
      line: 3,
      locals: { return: String(value) },
      description: `${label} — ${a} + ${b} = ${value}`,
    });
    events.push({
      type: 'return',
      returnValue: String(value),
      description: `${label} — return ${value}`,
    });
    return value;
  };
  walk(arg, 1);
  return overflowed !== undefined ? { events, overflowedAt: overflowed } : { events };
}

function traceHanoi(
  arg: number,
  maxDepth: number,
): { events: TraceEvent[]; overflowedAt?: number } {
  const events: TraceEvent[] = [];
  let overflowed: number | undefined;
  const walk = (n: number, from: string, to: string, aux: string, depth: number): void => {
    if (overflowed !== undefined) return;
    if (maxDepth > 0 && depth > maxDepth) {
      overflowed = depth;
      return;
    }
    const label = `hanoi(${n}, ${from}→${to})`;
    events.push({
      type: 'call',
      label,
      line: 1,
      locals: { n: String(n), from, to, aux },
      description: `invocando ${label}`,
    });
    if (n === 0) {
      events.push({ type: 'return', returnValue: '—', description: `${label} — caso base` });
      return;
    }
    events.push({
      type: 'line',
      line: 3,
      description: `${label} — mover ${n - 1} discos de ${from} a ${aux}`,
    });
    walk(n - 1, from, aux, to, depth + 1);
    if (overflowed !== undefined) return;
    events.push({
      type: 'line',
      line: 4,
      description: `${label} — imprimir movimiento: Disc ${n}: ${from} → ${to}`,
    });
    events.push({
      type: 'line',
      line: 5,
      description: `${label} — mover ${n - 1} discos de ${aux} a ${to}`,
    });
    walk(n - 1, aux, to, from, depth + 1);
    if (overflowed !== undefined) return;
    events.push({ type: 'return', returnValue: '—', description: `${label} — return` });
  };
  walk(arg, 'A', 'C', 'B', 1);
  return overflowed !== undefined ? { events, overflowedAt: overflowed } : { events };
}

/**
 * `power` — fast recursive exponentiation. `x^n` computed with the
 * halving trick: `x^n = (x^(n/2))^2` for even `n`, `x^n = x · (x^(n/2))^2`
 * for odd `n`. Depth is `log₂(n)`, so `power(13)` reaches depth 4.
 *
 * The base `x` is fixed at 2 for the trace so the widget only needs
 * a single `arg` prop (the exponent). Locals shown: `x`, `n`, `half`,
 * `return`. The `half` slot appears once the recursive call returns —
 * the frame that was waiting on it now knows the value.
 */
function tracePower(
  arg: number,
  maxDepth: number,
): { events: TraceEvent[]; overflowedAt?: number } {
  const events: TraceEvent[] = [];
  const walk = (e: number, depth: number): { overflow?: number; value?: number } => {
    if (maxDepth > 0 && depth > maxDepth) return { overflow: depth };
    const label = `power(${POWER_BASE}, ${e})`;
    events.push({
      type: 'call',
      label,
      line: 1,
      locals: { x: String(POWER_BASE), e: String(e), return: '?' },
      description: `invocando ${label}`,
    });
    events.push({
      type: 'line',
      line: 2,
      description: `${label} — revisando caso base`,
    });
    if (e === 0) {
      events.push({
        type: 'return',
        returnValue: '1',
        description: `${label} — caso base, return 1`,
      });
      return { value: 1 };
    }
    const halfArg = Math.floor(e / 2);
    events.push({
      type: 'line',
      line: 3,
      description: `${label} — llamando power(${POWER_BASE}, ${halfArg})`,
    });
    const sub = walk(halfArg, depth + 1);
    if (sub.overflow !== undefined) return sub;
    const halfVal = sub.value!;
    events.push({
      type: 'line',
      line: 3,
      locals: { half: String(halfVal) },
      description: `${label} — recibí half = ${halfVal}`,
    });
    events.push({
      type: 'line',
      line: 4,
      description: `${label} — e % 2 = ${e % 2}`,
    });
    const value = e % 2 === 0 ? halfVal * halfVal : POWER_BASE * halfVal * halfVal;
    const returnLine = e % 2 === 0 ? 4 : 5;
    events.push({
      type: 'line',
      line: returnLine,
      locals: { return: String(value) },
      description:
        e % 2 === 0
          ? `${label} — e par: return ${halfVal} × ${halfVal} = ${value}`
          : `${label} — e impar: return ${POWER_BASE} × ${halfVal} × ${halfVal} = ${value}`,
    });
    events.push({
      type: 'return',
      returnValue: String(value),
      description: `${label} — return ${value}`,
    });
    return { value };
  };
  const result = walk(arg, 1);
  if (result.overflow !== undefined) return { events, overflowedAt: result.overflow };
  return { events };
}

function traceBroken(
  arg: number,
  maxDepth: number,
): { events: TraceEvent[]; overflowedAt?: number } {
  const events: TraceEvent[] = [];
  const cap = maxDepth > 0 ? maxDepth : BROKEN_DEFAULT_DEPTH;
  let n = arg;
  let depth = 1;
  while (depth <= cap) {
    const label = `broken(${n})`;
    events.push({
      type: 'call',
      label,
      line: 2,
      locals: { n: String(n), return: '?' },
      description: `invocando ${label} — sin caso base, empuja frame nuevo`,
    });
    n -= 1;
    depth += 1;
  }
  const label = `broken(${n})`;
  events.push({
    type: 'call',
    label,
    line: 2,
    locals: { n: String(n), return: '?' },
    description: `invocando ${label} — el stack ya no acepta más frames`,
  });
  return { events, overflowedAt: depth };
}
