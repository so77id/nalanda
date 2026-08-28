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
  changedMemo?: number;
  changedDone?: number;
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
    <div className="flex flex-col gap-3 font-mono text-xs" data-testid="fib-memo-visual">
      <div>
        <div className="mb-1 text-3xs uppercase tracking-wide text-ink-faint">
          Stack (llamadas activas)
        </div>
        {snap.stack.length === 0 ? (
          <p className="text-3xs italic text-ink-faint">vacío</p>
        ) : (
          <div className="flex flex-col-reverse gap-1">
            {snap.stack.map((label, i) => {
              const isCacheHit =
                snap.cacheHit !== undefined &&
                i === snap.stack.length - 1 &&
                label.endsWith(`(${snap.cacheHit})`);
              return (
                <div
                  key={`${label}-${i}`}
                  data-testid="fib-memo-frame"
                  className={
                    'rounded border px-2 py-1 ' +
                    (isCacheHit
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-rule bg-surface text-ink')
                  }
                >
                  {label}
                  {isCacheHit ? ' · cache hit' : ''}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-3xs uppercase tracking-wide text-ink-faint">memo[]</div>
        <div className="flex gap-1">
          {snap.memo.map((v, i) => (
            <div
              key={i}
              data-testid="fib-memo-cell"
              className={
                'flex h-10 w-10 flex-col items-center justify-center rounded border ' +
                (snap.changedMemo === i
                  ? 'border-accent bg-accent-soft text-accent'
                  : v === null
                    ? 'border-dashed border-rule/60 text-ink-faint'
                    : 'border-rule bg-sunk/40 text-ink')
              }
            >
              <span className="text-xs">{v === null ? '?' : v}</span>
              <span className="text-3xs text-ink-faint">{i}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-3xs uppercase tracking-wide text-ink-faint">done[]</div>
        <div className="flex gap-1">
          {snap.done.map((d, i) => (
            <div
              key={i}
              data-testid="fib-done-cell"
              className={
                'flex h-6 w-10 items-center justify-center rounded border text-xs ' +
                (snap.changedDone === i
                  ? 'border-accent bg-accent-soft text-accent'
                  : d
                    ? 'border-rule bg-sunk/40 text-ink'
                    : 'border-dashed border-rule/60 text-ink-faint')
              }
            >
              {d ? 'T' : 'F'}
            </div>
          ))}
        </div>
        <div className="mt-0.5 flex gap-1 text-3xs text-ink-faint">
          {Array.from({ length: size }, (_, i) => (
            <span key={i} className="w-10 text-center">
              {i}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-ink-soft">{snap.caption}</p>
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
    extra: { changedMemo?: number; changedDone?: number; cacheHit?: number } = {},
  ) => {
    events.push({
      line,
      stack: [...stack],
      memo: [...memo],
      done: [...done],
      caption,
      ...extra,
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
    snap(3, `fib(${n}) — miramos done[${n}].`);
    if (done[n]) {
      const v = memo[n]!;
      snap(3, `fib(${n}) — CACHE HIT, devolvemos memo[${n}] = ${v} en O(1).`, { cacheHit: n });
      stack.pop();
      return v;
    }
    snap(4, `fib(${n}) — cache miss, calculamos fib(${n - 1}) + fib(${n - 2}).`);
    const a = fib(n - 1);
    const b = fib(n - 2);
    const r = a + b;
    memo[n] = r;
    snap(5, `fib(${n}) — guardamos memo[${n}] = ${r}.`, { changedMemo: n });
    done[n] = true;
    snap(6, `fib(${n}) — marcamos done[${n}] = true.`, { changedDone: n });
    snap(7, `fib(${n}) — return ${r}.`);
    stack.pop();
    return r;
  };

  fib(target);
  return events;
}
