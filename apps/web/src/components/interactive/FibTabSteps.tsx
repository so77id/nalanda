import { readWriteBorderClass, ReadWriteLegend } from './readWriteVocabulary';
import { Step } from './Step';
import { StepShow } from './StepShow';

export interface FibTabStepsProps {
  /**
   * Target n for the tabulated fib. Non-negative integer; small values
   * (3–8) work best pedagogically — the trace is linear, so it stays
   * legible up to ~10. Default 5.
   */
  target?: number;
  /** Optional widget title shown above the panels. */
  title?: string;
}

interface Snapshot {
  line: number;
  f: (number | null)[];
  i: number | null;
  caption: string;
  reads?: [number, number];
  write?: number;
}

const CODE = `static long fib(int n) {
    if (n < 2) return n;
    long[] f = new long[n + 1];
    f[0] = 0;
    f[1] = 1;
    for (int i = 2; i <= n; i++) {
        f[i] = f[i - 1] + f[i - 2];
    }
    return f[n];
}`;

/**
 * Step-by-step visualization of bottom-up tabulated Fibonacci (ADR-0043,
 * on top of the `<StepShow>` primitive).
 *
 * Simpler cousin of `<FibMemoSteps>`: no stack, no `done`. The trace
 * is linear — initialize `f[0]` and `f[1]`, then walk the `for` from
 * `i = 2` to `n` filling each cell from its two predecessors. Each
 * transition becomes one `<Step>` inside a `<StepShow>`.
 */
export function FibTabSteps({ target = 5, title }: FibTabStepsProps) {
  const snapshots = buildTrace(target);

  return (
    <StepShow code={CODE} language="java" title={title}>
      {snapshots.map((snap, i) => (
        <Step key={i} lines={[snap.line]}>
          <FibTabVisual snap={snap} />
        </Step>
      ))}
    </StepShow>
  );
}

function FibTabVisual({ snap }: { snap: Snapshot }) {
  const size = snap.f.length;
  return (
    <div className="flex flex-col gap-3 font-mono text-xs" data-testid="fib-tab-visual">
      <div className="text-xs text-ink-soft">
        {snap.i === null ? 'Inicialización' : `Iteración: i = ${snap.i}`}
      </div>

      <ArrayTable
        size={size}
        reads={snap.reads}
        write={snap.write}
        cells={snap.f.map((v) => (v === null ? '?' : String(v)))}
      />

      <p className="text-xs text-ink-soft">{snap.caption}</p>

      <ReadWriteLegend />

      <div className="text-3xs text-ink-faint">
        Sin stack de llamadas: la iteración vive en un frame único, sin recursión.
      </div>
    </div>
  );
}

interface ArrayTableProps {
  cells: string[];
  size: number;
  reads?: [number, number];
  write?: number;
}

/**
 * Single-row array visualization with shared indices below. Same
 * layout as the ArrayTable in FibMemoSteps but with one row. Colour
 * semantics come from `readWriteVocabulary`, the shared
 * read/write/dim rule the three fib-step widgets use.
 */
function ArrayTable({ cells, size, reads, write }: ArrayTableProps) {
  return (
    <div className="inline-flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="w-8 shrink-0 text-right text-3xs uppercase tracking-wide text-ink-faint">
          f[]
        </div>
        <div className="flex gap-0.5">
          {cells.map((v, i) => {
            const border = readWriteBorderClass({
              isRead: reads?.includes(i) ?? false,
              isWrite: write === i,
              dimmed: v === '?',
            });
            return (
              <div
                key={i}
                data-testid="fib-tab-cell"
                className={`flex h-10 w-12 items-center justify-center rounded border text-sm ${border}`}
              >
                {v}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-8 shrink-0" />
        <div className="flex gap-0.5">
          {Array.from({ length: size }, (_, i) => (
            <span key={i} className="w-12 text-center text-3xs text-ink-faint">
              {i}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildTrace(target: number): Snapshot[] {
  const size = Math.max(target, 1) + 1;
  const f: (number | null)[] = new Array(size).fill(null);
  const events: Snapshot[] = [];

  const snap = (
    line: number,
    caption: string,
    extra: { i?: number | null; reads?: [number, number]; write?: number } = {},
  ) => {
    events.push({
      line,
      f: [...f],
      i: extra.i ?? null,
      caption,
      ...(extra.reads ? { reads: extra.reads } : {}),
      ...(extra.write !== undefined ? { write: extra.write } : {}),
    });
  };

  // Base case first — the Java shown above returns `n` directly when
  // n < 2 (before allocating f[]). Without this branch the widget
  // would trace an allocation + writes the code would never reach.
  if (target < 2) {
    snap(
      2,
      `Caso base: n = ${target} < 2, la función devuelve ${target} directamente sin llenar f[].`,
    );
    return events;
  }

  snap(3, `Reservamos f[] con espacio para ${size} celdas.`);
  f[0] = 0;
  snap(4, `Inicializamos f[0] = 0.`, { write: 0 });
  f[1] = 1;
  snap(5, `Inicializamos f[1] = 1.`, { write: 1 });

  for (let i = 2; i <= target; i++) {
    snap(6, `Entramos al for con i = ${i}.`, { i });
    const a = f[i - 1]!;
    const b = f[i - 2]!;
    const r = a + b;
    f[i] = r;
    snap(7, `f[${i}] = f[${i - 1}] + f[${i - 2}] = ${a} + ${b} = ${r}. Escribimos la celda.`, {
      i,
      reads: [i - 1, i - 2],
      write: i,
    });
  }

  snap(9, `Terminó el for: devolvemos f[${target}] = ${f[target]}.`);

  return events;
}
