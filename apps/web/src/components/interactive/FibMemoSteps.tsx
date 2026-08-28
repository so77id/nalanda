import { readWriteBorderClass, ReadWriteLegend } from './readWriteVocabulary';
import { Step } from './Step';
import { StepShow } from './StepShow';

export interface FibMemoStepsProps {
  /**
   * Target n for `fib(n)`. Must be a non-negative integer; small values
   * (2–7) work best pedagogically — the trace grows fast even with the
   * cache. Default 5.
   */
  target?: number;
  /** Optional widget title shown above the panels. */
  title?: string;
}

interface Snapshot {
  line: number;
  stack: string[];
  memo: (number | null)[];
  done: boolean[];
  caption: string;
  reads?: number[];
  write?: number;
  cacheHit?: number;
}

const CODE = `static long fib(int n) {
    if (n < 2) return n;
    if (done[n]) return memo[n];
    long r = fib(n - 1) + fib(n - 2);
    memo[n] = r;
    done[n] = true;
    return r;
}`;

/**
 * Step-by-step visualization of top-down memoized Fibonacci (ADR-0043,
 * on top of the `<StepShow>` primitive).
 *
 * Given a target n, the widget walks a real depth-first execution of
 * `fib(n)` with memoization and records each transition — the line
 * that just ran, the current call stack, the current `memo[]` and
 * `done[]`, and a Spanish caption. Each transition becomes one
 * `<Step>` inside a `<StepShow>`, so the reader can walk it with the
 * arrow keys and see the cache hits land where the tree would have
 * recomputed.
 *
 * Visual layout (v2, following the CallStack v4 pattern): memo[] and
 * done[] fill the main area on the left, and the call stack lives in
 * a transversal column on the right that scrolls internally. Cells
 * are painted with the same "read / write" vocabulary as the
 * bottom-up widget: reads in flag, writes in accent.
 */
export function FibMemoSteps({ target = 5, title }: FibMemoStepsProps) {
  const snapshots = buildTrace(target);

  return (
    <StepShow code={CODE} language="java" title={title}>
      {snapshots.map((snap, i) => (
        <Step key={i} lines={[snap.line]}>
          <FibMemoVisual snap={snap} />
        </Step>
      ))}
    </StepShow>
  );
}

function FibMemoVisual({ snap }: { snap: Snapshot }) {
  const size = snap.memo.length;
  return (
    <div
      className="flex flex-col gap-4 font-mono text-xs md:flex-row"
      data-testid="fib-memo-visual"
    >
      {/* Main area (~75%): memo[] + done[] as a shared array, caption, legend. */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 md:basis-3/4">
        <ArrayTable
          rows={[
            {
              label: 'memo[]',
              cellsTestId: 'fib-memo-cell',
              cells: snap.memo.map((v) => (v === null ? '?' : String(v))),
            },
            {
              label: 'done[]',
              cellsTestId: 'fib-done-cell',
              cells: snap.done.map((d) => (d ? 'T' : 'F')),
              dim: (v) => v === 'F',
            },
          ]}
          size={size}
          reads={snap.reads}
          write={snap.write}
        />
        <p className="text-xs text-ink-soft">{snap.caption}</p>
        <ReadWriteLegend />
      </div>

      {/* Right column (~25%): stack, transversal, own scroll. Same shape as
          the CallStack widget so a reader who has seen one recognizes the
          other. */}
      <div className="relative rounded border border-rule bg-sunk/30 md:basis-1/4 md:overflow-hidden">
        <div className="flex flex-col p-3 md:absolute md:inset-0">
          <div className="mb-2 text-3xs uppercase tracking-wide text-ink-faint">Stack</div>
          <div
            className="flex flex-1 flex-col gap-1 overflow-y-auto pr-1 md:min-h-0"
            role="list"
            aria-label="Frames pausados en el stack (cima arriba)"
            data-testid="fib-memo-stack-scroll"
          >
            {snap.stack.length === 0 ? (
              <p
                className="text-center text-3xs italic text-ink-faint"
                data-testid="fib-memo-stack-empty"
              >
                vacío
              </p>
            ) : (
              [...snap.stack].reverse().map((label, i, reversed) => {
                const isCacheHit =
                  snap.cacheHit !== undefined && i === 0 && label.endsWith(`(${snap.cacheHit})`);
                void reversed;
                return (
                  <div
                    key={`${label}-${i}`}
                    data-testid="fib-memo-frame"
                    className={
                      'shrink-0 rounded border px-2 py-1 ' +
                      (isCacheHit
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-rule bg-surface text-ink')
                    }
                  >
                    {label}
                    {isCacheHit ? ' · cache hit' : ''}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ArrayRow {
  label: string;
  cellsTestId: string;
  cells: string[];
  /** Predicate for cells that render dimmed (empty-slot styling). */
  dim?: (v: string) => boolean;
}

interface ArrayTableProps {
  rows: ArrayRow[];
  size: number;
  reads?: number[];
  write?: number;
}

/**
 * A shared-index array visualization. All rows share the same column
 * layout so a reader sees them as one 2D object (memo[] on top,
 * done[] below), and a single row of indices at the bottom labels
 * both. Each cell is 3rem wide, borders are solid on the outside so
 * consecutive cells read as a contiguous strip.
 */
function ArrayTable({ rows, size, reads, write }: ArrayTableProps) {
  return (
    <div className="inline-flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          <div className="w-16 shrink-0 text-right text-3xs uppercase tracking-wide text-ink-faint">
            {row.label}
          </div>
          <div className="flex gap-0.5">
            {row.cells.map((v, i) => (
              <ArrayCell
                key={i}
                value={v}
                index={i}
                isRead={reads?.includes(i) ?? false}
                isWrite={write === i}
                dimmed={row.dim?.(v) ?? false}
                testId={row.cellsTestId}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <div className="w-16 shrink-0" />
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

interface ArrayCellProps {
  value: string;
  index: number;
  isRead: boolean;
  isWrite: boolean;
  dimmed: boolean;
  testId: string;
}

function ArrayCell({ value, isRead, isWrite, dimmed, testId }: ArrayCellProps) {
  const border = readWriteBorderClass({ isRead, isWrite, dimmed });
  return (
    <div
      data-testid={testId}
      className={`flex h-10 w-12 items-center justify-center rounded border text-sm ${border}`}
    >
      {value}
    </div>
  );
}

function buildTrace(target: number): Snapshot[] {
  const size = Math.max(target, 1) + 1;
  const memo: (number | null)[] = new Array(size).fill(null);
  const done: boolean[] = new Array(size).fill(false);
  const stack: string[] = [];
  const events: Snapshot[] = [];

  const snap = (
    line: number,
    caption: string,
    extra: { reads?: number[]; write?: number; cacheHit?: number } = {},
  ) => {
    events.push({
      line,
      stack: [...stack],
      memo: [...memo],
      done: [...done],
      caption,
      ...(extra.reads ? { reads: extra.reads } : {}),
      ...(extra.write !== undefined ? { write: extra.write } : {}),
      ...(extra.cacheHit !== undefined ? { cacheHit: extra.cacheHit } : {}),
    });
  };

  const fib = (n: number): number => {
    stack.push(`fib(${n})`);
    snap(2, `Invocamos fib(${n}) — miramos si está el caso base.`);
    if (n < 2) {
      snap(2, `fib(${n}) — caso base, devuelve ${n}.`);
      stack.pop();
      return n;
    }
    snap(3, `fib(${n}) — miramos done[${n}].`, { reads: [n] });
    if (done[n]) {
      const v = memo[n]!;
      snap(3, `fib(${n}) — CACHE HIT, devolvemos memo[${n}] = ${v} en O(1).`, {
        reads: [n],
        cacheHit: n,
      });
      stack.pop();
      return v;
    }
    snap(4, `fib(${n}) — cache miss, calculamos fib(${n - 1}) + fib(${n - 2}).`);
    const a = fib(n - 1);
    const b = fib(n - 2);
    const r = a + b;
    memo[n] = r;
    snap(5, `fib(${n}) — guardamos memo[${n}] = ${a} + ${b} = ${r}.`, {
      reads: [n - 1, n - 2],
      write: n,
    });
    done[n] = true;
    snap(6, `fib(${n}) — marcamos done[${n}] = true.`, { write: n });
    snap(7, `fib(${n}) — return ${r}.`);
    stack.pop();
    return r;
  };

  fib(target);
  return events;
}
