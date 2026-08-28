import { readWriteBorderClass, ReadWriteLegend } from './readWriteVocabulary';
import { Step } from './Step';
import { StepShow } from './StepShow';

export interface FibIterStepsProps {
  /**
   * Target n for the iterative fib. Non-negative integer; small values
   * (3–8) work best pedagogically — the trace is linear, so it stays
   * legible up to ~10. Default 5.
   */
  target?: number;
  /** Optional widget title shown above the panels. */
  title?: string;
}

interface Snapshot {
  line: number;
  previous: number | null;
  current: number | null;
  next: number | null;
  i: number | null;
  caption: string;
  /** Names of variables that were read to produce this step. */
  reads?: ('previous' | 'current')[];
  /** Name of the variable that was written on this step. */
  write?: 'previous' | 'current' | 'next';
}

const CODE = `static long fib(int n) {
    if (n < 2) return n;
    long previous = 0, current = 1;
    for (int i = 2; i <= n; i++) {
        long next = previous + current;
        previous = current;
        current = next;
    }
    return current;
}`;

/**
 * Step-by-step visualization of the memory-collapsed bottom-up
 * Fibonacci (ADR-0043, on top of the `<StepShow>` primitive).
 *
 * The full table version lives in `<FibTabSteps>`; this widget shows
 * the sliding-window variant with only two live variables. Same
 * highlight vocabulary: reads in flag, writes in accent. No stack,
 * no array — just the two-variable window sliding one step per
 * iteration.
 */
export function FibIterSteps({ target = 5, title }: FibIterStepsProps) {
  const snapshots = buildTrace(target);

  return (
    <StepShow code={CODE} language="java" title={title}>
      {snapshots.map((snap, i) => (
        <Step key={i} lines={[snap.line]}>
          <FibIterVisual snap={snap} />
        </Step>
      ))}
    </StepShow>
  );
}

function FibIterVisual({ snap }: { snap: Snapshot }) {
  return (
    <div className="flex flex-col gap-3 font-mono text-xs" data-testid="fib-iter-visual">
      <div className="text-xs text-ink-soft">
        {snap.i === null ? 'Inicialización' : `Iteración: i = ${snap.i}`}
      </div>

      <div className="flex gap-2">
        <VarCell
          name="previous"
          value={snap.previous}
          isRead={snap.reads?.includes('previous') ?? false}
          isWrite={snap.write === 'previous'}
        />
        <VarCell
          name="current"
          value={snap.current}
          isRead={snap.reads?.includes('current') ?? false}
          isWrite={snap.write === 'current'}
        />
        <VarCell name="next" value={snap.next} isRead={false} isWrite={snap.write === 'next'} />
      </div>

      <p className="text-xs text-ink-soft">{snap.caption}</p>

      <ReadWriteLegend />

      <div className="text-3xs text-ink-faint">
        Sin stack, sin arreglo: solo dos variables vivas por iteración.
      </div>
    </div>
  );
}

interface VarCellProps {
  name: string;
  value: number | null;
  isRead: boolean;
  isWrite: boolean;
}

function VarCell({ name, value, isRead, isWrite }: VarCellProps) {
  const border = readWriteBorderClass({ isRead, isWrite, dimmed: value === null });
  return (
    <div
      data-testid="fib-iter-cell"
      data-var={name}
      className={`flex h-14 w-24 flex-col items-center justify-center rounded border ${border}`}
    >
      <span className="text-3xs text-ink-faint">{name}</span>
      <span className="text-sm">{value === null ? '—' : value}</span>
    </div>
  );
}

function buildTrace(target: number): Snapshot[] {
  const events: Snapshot[] = [];

  let previous: number | null = null;
  let current: number | null = null;
  let next: number | null = null;

  const snap = (
    line: number,
    caption: string,
    extra: {
      i?: number | null;
      reads?: ('previous' | 'current')[];
      write?: 'previous' | 'current' | 'next';
    } = {},
  ) => {
    events.push({
      line,
      previous,
      current,
      next,
      i: extra.i ?? null,
      caption,
      ...(extra.reads ? { reads: extra.reads } : {}),
      ...(extra.write ? { write: extra.write } : {}),
    });
  };

  // Base case first — the Java shown above returns `n` directly when
  // n < 2, so the widget has to honor that path too. Otherwise a
  // teacher passing `target={0}` or `target={1}` would see the trace
  // walk through the two-variable init (a lie about what the code
  // does).
  if (target < 2) {
    snap(2, `Caso base: n = ${target} < 2, la función devuelve ${target} directamente.`);
    return events;
  }

  previous = 0;
  current = 1;
  snap(3, `Inicializamos previous = 0 y current = 1 (los dos primeros valores).`, {
    write: 'current',
  });

  for (let i = 2; i <= target; i++) {
    snap(4, `Entramos al for con i = ${i}.`, { i });
    next = previous + current;
    snap(5, `next = previous + current = ${previous} + ${current} = ${next}.`, {
      i,
      reads: ['previous', 'current'],
      write: 'next',
    });
    previous = current;
    snap(6, `previous = current (deslizamos la ventana).`, {
      i,
      reads: ['current'],
      write: 'previous',
    });
    current = next;
    snap(7, `current = next (deslizamos la ventana).`, { i, write: 'current' });
  }

  next = null;
  snap(9, `Terminó el for: devolvemos current = ${current}.`);

  return events;
}
