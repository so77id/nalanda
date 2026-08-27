import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';

/**
 * A single event in the execution trace: either a function ENTER
 * (push a frame on the stack) or a function RETURN (pop the top frame).
 *
 * Push events carry the frame's identity — its label and the source line at
 * which the call was made. Pop events carry the value the function returned,
 * which the widget bubbles up onto the caller's frame so the reader can see
 * the value being carried back.
 */
export type TraceEvent =
  { type: 'push'; label: string; line?: number } | { type: 'pop'; returnValue: string };

/**
 * A recipe knows how to generate its own execution trace. Named rather than
 * function-valued because MDX props pass through the serializer, and a lambda
 * in a fence would be worse for the author than the small set of names the
 * course actually uses.
 */
type Recipe = {
  /** The default code shown in the code panel — matches what the recipe traces. */
  defaultCode: string;
  /** Language for the code editor. */
  language: string;
  /** Generate the linear event trace for this recipe at the given argument. */
  trace: (arg: number, maxDepth: number) => { events: TraceEvent[]; overflowedAt?: number };
};

const RECIPES: Record<string, Recipe> = {
  factorial: {
    language: 'java',
    defaultCode: `static long factorial(int n) {
    if (n == 0) return 1;
    return n * factorial(n - 1);
}`,
    trace: (arg, maxDepth) => traceFactorial(arg, maxDepth),
  },
  sum: {
    language: 'java',
    defaultCode: `static long sum(int n) {
    if (n == 0) return 0;
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
  broken: {
    language: 'java',
    defaultCode: `// Recursion without a base case: never terminates.
static long broken(int n) {
    return 1 + broken(n - 1);
}`,
    trace: (arg, maxDepth) => traceBroken(arg, maxDepth),
  },
};

/**
 * Absolute ceiling on trace length — even without a `maxDepth` request, we
 * clip so a `fib(30)` fence cannot freeze the tab. Above this the widget
 * refuses to render with an authoring error. `fib(10)` is 177 events;
 * `factorial(50)` is 100. The cap is generous but bounded.
 */
const MAX_TRACE_LENGTH = 2000;

/**
 * When `maxDepth === 0` (default) we don't simulate the JVM stack limit but
 * we still need a runtime cap for the `broken` recipe (which never terminates).
 * Broken defaults to a small depth so the StackOverflow demo shows something
 * legible at the deck's default sizing.
 */
const BROKEN_DEFAULT_DEPTH = 8;

export interface CallStackProps {
  /** Which recipe to trace. See RECIPES. */
  recipe?: string;
  /** Root argument. Must be a non-negative integer. */
  arg?: number;
  /**
   * Simulated stack size limit. `0` (default) means unlimited (the real JVM
   * has ~10⁴ frames, but the trace cap will bite first). A positive value
   * triggers a StackOverflowError when a push would exceed it, and the trace
   * stops with the offending frame highlighted.
   */
  maxDepth?: number;
  /** Language for the code editor. Defaults to the recipe's own default. */
  language?: string;
  /** Code source shown in the left panel. Defaults to the recipe's own code. */
  code?: string;
  /** Optional heading in the widget's header. */
  title?: string;
  /** If true, autoplay starts immediately. Default false. */
  autoplay?: boolean;
  /** Playback speed multiplier: 0.5, 1, 2. Default 1. */
  speed?: number;
}

/**
 * A widget that makes the JVM call stack visible during a recursive execution
 * (ADR-0049).
 *
 * Layout: CodeStepper on the left, stack of frames on the right. The stack
 * grows upward (base at bottom, cima at top) matching how sistemas courses
 * draw it and how memory addresses climb. Each frame shows the function name
 * with its arguments; on pop, the frame flashes briefly with its return value
 * before disappearing.
 *
 * Playback is manual by default — the reader steps forward and backward
 * through the trace with the controls below. Autoplay is available when the
 * author declares it or the reader clicks Play.
 *
 * The `broken` recipe demonstrates StackOverflowError: recursion without a
 * base case pushes frames indefinitely, capped by `maxDepth` (defaults to 8
 * for the `broken` recipe so the deck sees the error quickly).
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
    const delay = 700 / Math.max(0.25, speed);
    const timeout = window.setTimeout(() => setStep((s) => s + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [isPlaying, step, speed, traceResult]);

  if (recipe === undefined || known === undefined) {
    return (
      <AuthoringError component="CallStack">
        {recipe === undefined ? (
          <>
            falta la prop <code>recipe</code>. Recetas conocidas:{' '}
            {Object.keys(RECIPES)
              .map((r) => <code key={r}>{r}</code>)
              .reduce(
                (prev, curr, i) => (i === 0 ? [curr] : [...prev, ', ', curr]),
                [] as unknown[],
              )}
            .
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

  const overflowed = traceResult.overflowedAt !== undefined;
  const clampedStep = Math.min(step, traceResult.events.length);
  const frames = renderStack(traceResult.events, clampedStep);
  const returnedValue = getRecentReturn(traceResult.events, clampedStep);

  const canStepBack = clampedStep > 0;
  const canStepForward = clampedStep < traceResult.events.length;
  const atEnd = !canStepForward;

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
            `profundidad: ${frames.length}`
          )}
        </span>
      </header>

      <div className="grid grid-cols-1 border-t border-rule md:grid-cols-[1fr_20rem]">
        <div className="min-w-0 overflow-hidden border-b border-rule md:border-b-0 md:border-r">
          <CodeStepper
            code={code ?? known.defaultCode}
            language={language ?? known.language}
            highlightLines={
              frames.length > 0 && frames[frames.length - 1]!.line !== undefined
                ? [frames[frames.length - 1]!.line!]
                : []
            }
          />
        </div>
        <div
          className="flex min-h-[12rem] flex-col-reverse gap-1 bg-sunk/30 p-3 font-mono text-xs"
          role="list"
          aria-label="Frames del stack de llamadas (base abajo, cima arriba)"
        >
          {frames.length === 0 ? (
            <p className="text-center text-ink-faint">
              Stack vacío — click en <span className="font-semibold">Paso</span> para arrancar.
            </p>
          ) : (
            frames.map((frame, i) => {
              const isTop = i === frames.length - 1;
              const isOverflowing = overflowed && isTop;
              return (
                <div
                  key={i}
                  role="listitem"
                  data-testid="callstack-frame"
                  className={`flex items-baseline justify-between rounded border px-2 py-1 ${
                    isOverflowing
                      ? 'border-flag bg-flag-soft text-flag animate-pulse'
                      : isTop
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-rule bg-surface text-ink-soft'
                  }`}
                >
                  <span className="font-semibold">{frame.label}</span>
                  <span className="text-3xs text-ink-faint">
                    {frame.pendingReturn !== undefined
                      ? `→ ${frame.pendingReturn}`
                      : frame.line !== undefined
                        ? `L${frame.line}`
                        : ''}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {overflowed && (
        <div className="border-t border-rule bg-flag-soft px-3 py-2 text-xs text-flag">
          <strong>StackOverflowError</strong> · el stack alcanzó la profundidad{' '}
          {traceResult.overflowedAt}. La recursión no encontró un caso base — o el problema es más
          profundo que el stack disponible.
        </div>
      )}

      {returnedValue !== null && !overflowed && (
        <div className="border-t border-rule bg-sunk px-3 py-1.5 text-xs text-ink-soft">
          Último retorno: <span className="font-mono font-semibold text-ink">{returnedValue}</span>
        </div>
      )}

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
          onClick={() => setStep((s) => Math.min(traceResult.events.length, s + 1))}
          disabled={!canStepForward}
          className="rounded border border-rule bg-surface px-2 py-1 text-ink-soft hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label="Paso adelante"
        >
          <SkipForward size={12} />
        </button>
        <span className="ml-auto text-3xs text-ink-faint">
          paso {clampedStep} / {traceResult.events.length}
        </span>
      </div>
    </div>
  );
}

interface DisplayFrame {
  label: string;
  line?: number;
  pendingReturn?: string;
}

/**
 * Replay the trace up to `step` events and return the live stack of frames.
 * The last event, if it was a `pop`, leaves its return value bubbled onto the
 * caller's frame — the reader sees the value being carried back.
 */
function renderStack(events: TraceEvent[], step: number): DisplayFrame[] {
  const stack: DisplayFrame[] = [];
  let lastReturn: string | undefined;
  for (let i = 0; i < step && i < events.length; i++) {
    const event = events[i]!;
    if (event.type === 'push') {
      stack.push({ label: event.label, line: event.line });
      lastReturn = undefined;
    } else {
      stack.pop();
      lastReturn = event.returnValue;
    }
  }
  if (lastReturn !== undefined && stack.length > 0) {
    stack[stack.length - 1] = { ...stack[stack.length - 1]!, pendingReturn: lastReturn };
  }
  return stack;
}

function getRecentReturn(events: TraceEvent[], step: number): string | null {
  if (step === 0) return null;
  const event = events[step - 1]!;
  if (event.type === 'pop') return event.returnValue;
  return null;
}

// ---------------------------------------------------------------------
// Recipe implementations. Each generates the linear event trace.
// ---------------------------------------------------------------------

function traceFactorial(
  arg: number,
  maxDepth: number,
): { events: TraceEvent[]; overflowedAt?: number } {
  const events: TraceEvent[] = [];
  const walk = (n: number, depth: number): { overflow?: number; value?: number } => {
    if (maxDepth > 0 && depth > maxDepth) return { overflow: depth };
    events.push({ type: 'push', label: `factorial(${n})`, line: 1 });
    if (n === 0) {
      events.push({ type: 'pop', returnValue: '1' });
      return { value: 1 };
    }
    const sub = walk(n - 1, depth + 1);
    if (sub.overflow !== undefined) return sub;
    const value = n * sub.value!;
    events.push({ type: 'pop', returnValue: String(value) });
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
    events.push({ type: 'push', label: `sum(${n})`, line: 1 });
    if (n === 0) {
      events.push({ type: 'pop', returnValue: '0' });
      return { value: 0 };
    }
    const sub = walk(n - 1, depth + 1);
    if (sub.overflow !== undefined) return sub;
    const value = n + sub.value!;
    events.push({ type: 'pop', returnValue: String(value) });
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
    events.push({ type: 'push', label: `fib(${n})`, line: 1 });
    if (n < 2) {
      events.push({ type: 'pop', returnValue: String(n) });
      return n;
    }
    const a = walk(n - 1, depth + 1);
    if (overflowed !== undefined) return 0;
    const b = walk(n - 2, depth + 1);
    if (overflowed !== undefined) return 0;
    const value = a + b;
    events.push({ type: 'pop', returnValue: String(value) });
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
    events.push({ type: 'push', label: `hanoi(${n}, ${from}, ${to}, ${aux})`, line: 1 });
    if (n === 0) {
      events.push({ type: 'pop', returnValue: '—' });
      return;
    }
    walk(n - 1, from, aux, to, depth + 1);
    if (overflowed !== undefined) return;
    walk(n - 1, aux, to, from, depth + 1);
    if (overflowed !== undefined) return;
    events.push({ type: 'pop', returnValue: '—' });
  };
  walk(arg, 'A', 'C', 'B', 1);
  return overflowed !== undefined ? { events, overflowedAt: overflowed } : { events };
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
    events.push({ type: 'push', label: `broken(${n})`, line: 2 });
    n -= 1;
    depth += 1;
  }
  events.push({ type: 'push', label: `broken(${n})`, line: 2 });
  return { events, overflowedAt: depth };
}
