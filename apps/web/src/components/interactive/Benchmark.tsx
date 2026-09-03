import { Loader, Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RuntimeId } from '../../lib/runtimeIds';
import { RunAbandonedError } from '../../runtime';
import { AuthoringError } from '../AuthoringError';
import { LazyCodeEditor } from './lazyCodeEditor';
import { OUTPUT, Panel } from './Panel';
import { useLoadedRuntime } from './useLoadedRuntime';

/**
 * Wire protocol between the widget and every implementation it drives.
 *
 * Each implementation reads N from stdin, runs its algorithm timed by
 * `System.nanoTime()`, and prints exactly `${TIME_MARK}<ns>` on a line of its
 * own — anything else the program prints is ignored. The measurement lives
 * INSIDE the JVM on purpose: the pedagogical point of this widget is that a
 * stopwatch does not measure the algorithm, and putting the timer around the
 * `await run(...)` in JS would fold the whole "run this Java through CheerpJ"
 * round-trip into every measurement. `nanoTime` inside the algorithm is
 * exactly the wrong tool the class calls out — that is the point.
 */
export const TIME_MARK = 'time_ns:';

export interface BenchmarkImplementation {
  /** Human-readable name shown in the code header and the result row. Required, must be unique in the list. */
  name: string;
  /** Self-contained Java source: reads N from stdin, prints `time_ns:<ns>` on one line, may print anything else beside. */
  code: string;
}

export interface BenchmarkProps {
  /** Which runtime compiles and runs the code. Only Java validates today. */
  language?: RuntimeId;
  /** Implementations to compare side by side. Required, 1–4 practical. */
  implementations?: BenchmarkImplementation[];
  /** N presets shown as buttons the reader picks between before pressing Run. */
  inputs?: number[];
  /** Which preset is selected on first render. Falls back to the middle of `inputs`. */
  defaultInput?: number;
  /** Warmup runs discarded per implementation to avoid JIT warmup skew in the mediana. */
  warmupRuns?: number;
  /** Measured runs used to compute median / min / max per implementation. */
  measuredRuns?: number;
  /** Hard cap per single execution (ms). Exceeded → marked TIMEOUT, next implementation. */
  timeoutMs?: number;
  /** When true, kick off the measurement automatically once the runtime is
   * ready, so the reader lands on populated numbers. The Run button remains,
   * so the reader can re-measure at the same or a different N. Default false. */
  autoplay?: boolean;
}

interface RunResult {
  /** Median wall-clock time in ms, or null if the implementation failed / timed out. */
  medianMs: number | null;
  /** Fastest of the measured runs. */
  minMs: number | null;
  /** Slowest of the measured runs. */
  maxMs: number | null;
  /** True if any of the measured runs exceeded `timeoutMs`. */
  timedOut: boolean;
  /** One-line failure reason (compile error, runtime crash, module load failure). */
  failure: string | null;
}

const DEFAULT_INPUTS = [100, 10_000, 1_000_000, 10_000_000];
const DEFAULT_WARMUP = 2;
const DEFAULT_MEASURED = 5;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * A widget that runs several implementations of the same algorithm and shows the
 * timings side by side, in the reader's own browser (ADR-0044).
 *
 * The pedagogical point is a single, honest one: measuring an algorithm with a
 * stopwatch does not compare algorithms — it compares laptops. The reader runs
 * the widget on their machine; the professor runs it on theirs; every number is
 * different, and the class of Complejidad opens with exactly this failure.
 *
 * The widget does not decide who wins: it prints median, min and max per
 * implementation and the reader draws the conclusion. A run that exceeds
 * `timeoutMs` is marked TIMEOUT and the next implementation continues — the
 * quadratic case at N = 10⁷ is expected to hit the wall, and hiding it behind
 * a spinner defeats the lesson.
 *
 * Same runtime seam every other Java-driving widget uses (`useLoadedRuntime`),
 * same listing surface (`<LazyCodeEditor>` — no reimplementation of the
 * highlighter). Guarded structurally at the same three lines every
 * runtime-plus-editor component carries in `apps/web/src/architecture.test.ts`.
 */
export function Benchmark({
  language = 'java',
  implementations,
  inputs = DEFAULT_INPUTS,
  defaultInput,
  warmupRuns = DEFAULT_WARMUP,
  measuredRuns = DEFAULT_MEASURED,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  autoplay = false,
}: BenchmarkProps) {
  const { run, ready, failure: loadFailure } = useLoadedRuntime(language);

  const chosenDefault = useMemo(() => {
    if (defaultInput !== undefined && inputs.includes(defaultInput)) return defaultInput;
    return inputs[Math.floor(inputs.length / 2)] ?? inputs[0] ?? 0;
  }, [defaultInput, inputs]);

  const [selectedN, setSelectedN] = useState<number>(chosenDefault);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [results, setResults] = useState<Map<string, RunResult> | null>(null);
  const [activeImplIndex, setActiveImplIndex] = useState<number>(0);

  const runAll = useCallback(async () => {
    if (implementations === undefined || implementations.length === 0) return;
    setRunning(true);
    setResults(null);
    const collected = new Map<string, RunResult>();
    for (const impl of implementations) {
      setProgress(`${impl.name} · calentando…`);
      let compileFailure: string | null = null;
      let timedOut = false;
      const measured: number[] = [];
      try {
        // Warmup runs: discard the timings, but keep a compile failure that
        // shows up on the first attempt — a program that does not compile has
        // no measurement to make, and the reader deserves the compile log
        // rather than a mysterious "no timing" row.
        for (let i = 0; i < warmupRuns; i++) {
          const outcome = await runOnce(run, impl.code, selectedN, timeoutMs);
          if (outcome.kind === 'timeout') {
            timedOut = true;
            break;
          }
          if (outcome.kind === 'compile-failure') {
            compileFailure = outcome.log;
            break;
          }
          if (outcome.kind === 'crash') {
            compileFailure = outcome.message;
            break;
          }
        }
        if (compileFailure === null && !timedOut) {
          for (let i = 0; i < measuredRuns; i++) {
            setProgress(`${impl.name} · medición ${i + 1}/${measuredRuns}`);
            const outcome = await runOnce(run, impl.code, selectedN, timeoutMs);
            if (outcome.kind === 'timeout') {
              timedOut = true;
              break;
            }
            if (outcome.kind === 'compile-failure') {
              compileFailure = outcome.log;
              break;
            }
            if (outcome.kind === 'crash') {
              compileFailure = outcome.message;
              break;
            }
            if (outcome.kind === 'ok') {
              measured.push(outcome.ms);
            }
          }
        }
      } catch (error) {
        if (!(error instanceof RunAbandonedError)) {
          compileFailure = error instanceof Error ? error.message : String(error);
        }
      }
      if (measured.length === 0) {
        collected.set(impl.name, {
          medianMs: null,
          minMs: null,
          maxMs: null,
          timedOut,
          failure: compileFailure,
        });
      } else {
        collected.set(impl.name, {
          medianMs: median(measured),
          minMs: Math.min(...measured),
          maxMs: Math.max(...measured),
          timedOut,
          failure: null,
        });
      }
    }
    setResults(collected);
    setProgress('');
    setRunning(false);
  }, [implementations, run, selectedN, warmupRuns, measuredRuns, timeoutMs]);

  // Autoplay: kick off the measurement once the runtime is ready. Guarded by
  // a ref so a re-render (e.g. the reader hits Run themselves later) does not
  // launch a second auto-run in parallel.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoplay) return;
    if (!ready || running || results !== null || autoStartedRef.current) return;
    if (implementations === undefined || implementations.length === 0) return;
    autoStartedRef.current = true;
    void runAll();
  }, [autoplay, ready, running, results, implementations, runAll]);

  if (implementations === undefined || implementations.length === 0) {
    return (
      <AuthoringError component="Benchmark">
        falta la prop <code>implementations</code>: una lista con al menos una entrada{' '}
        <code>{'{ name, code }'}</code> por algoritmo a comparar.
      </AuthoringError>
    );
  }

  const diagnostics = loadFailure;

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-accent">
          benchmark
        </span>
        <span className="text-sm font-medium text-ink">
          {implementations.length} implementaciones · elige N y presiona Run
        </span>
      </header>

      {/*
       * Tabs above one full-width CodeEditor. The tabs share the same visual
       * language as ComplexityCounter's case tabs — user already knows what
       * a bordered underline row means. Only the selected implementation
       * renders its editor; the runtime state (results, running) applies to
       * ALL implementations because Run runs the whole set.
       */}
      <div className="flex border-b border-rule bg-sunk">
        {implementations.map((impl, i) => (
          <button
            key={impl.name}
            type="button"
            onClick={() => setActiveImplIndex(i)}
            aria-pressed={i === activeImplIndex}
            className={
              i === activeImplIndex
                ? 'border-b-2 border-accent px-3 py-1 font-mono text-xs font-medium text-ink'
                : 'border-b-2 border-transparent px-3 py-1 font-mono text-xs text-ink-soft hover:text-ink'
            }
          >
            {impl.name}
          </button>
        ))}
      </div>
      <div className="border-b border-rule">
        <LazyCodeEditor
          key={implementations[activeImplIndex]?.name ?? 'benchmark-code'}
          language={language}
          variant="read"
          showFileName={false}
          defaultValue={implementations[activeImplIndex]?.code ?? ''}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-rule px-3 py-2">
        <span className="text-3xs font-mono uppercase tracking-wide text-ink-faint">N:</span>
        {inputs.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setSelectedN(n)}
            disabled={running}
            aria-pressed={n === selectedN}
            className={
              n === selectedN
                ? 'rounded bg-accent px-2 py-0.5 text-xs font-medium text-on-accent'
                : 'rounded border border-rule bg-surface px-2 py-0.5 text-xs text-ink-soft hover:bg-sunk disabled:opacity-50'
            }
          >
            {formatN(n)}
          </button>
        ))}
      </div>

      {results !== null && (
        <div className="border-t border-rule">
          <Panel label={`resultados para N = ${formatN(selectedN)}`}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-rule text-3xs uppercase tracking-wide text-ink-faint">
                  <th className="px-2 py-1 text-left font-mono font-normal">implementación</th>
                  <th className="px-2 py-1 text-right font-mono font-normal">mediana</th>
                  <th className="px-2 py-1 text-right font-mono font-normal">min</th>
                  <th className="px-2 py-1 text-right font-mono font-normal">max</th>
                </tr>
              </thead>
              <tbody className="font-mono text-ink-soft">
                {implementations.map((impl) => {
                  const r = results.get(impl.name);
                  return (
                    <tr
                      key={impl.name}
                      className="border-b border-rule/50 last:border-0 even:bg-sunk/30 hover:bg-accent-soft/20"
                    >
                      <td className="px-2 py-1 text-ink">{impl.name}</td>
                      {r === undefined || r.medianMs === null ? (
                        <td colSpan={3} className="px-2 py-1 text-right text-flag">
                          {r?.timedOut === true
                            ? `TIMEOUT (> ${(timeoutMs / 1000).toFixed(0)} s)`
                            : (r?.failure ?? 'sin datos')}
                        </td>
                      ) : (
                        <>
                          <td className="px-2 py-1 text-right">{formatMs(r.medianMs)}</td>
                          <td className="px-2 py-1 text-right">
                            {r.minMs === null ? '—' : formatMs(r.minMs)}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {r.maxMs === null ? '—' : formatMs(r.maxMs)}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-3xs text-ink-faint">
              {measuredRuns} corridas por implementación ({warmupRuns} de warmup descartados).
              Timeout: {(timeoutMs / 1000).toFixed(0)} s por corrida.
            </p>
          </Panel>
        </div>
      )}

      {diagnostics !== null && diagnostics !== '' && (
        <Panel label="error al cargar el runtime">
          <pre className={`${OUTPUT} max-h-40 bg-sunk text-flag`}>{diagnostics}</pre>
        </Panel>
      )}

      <footer className="flex items-center gap-3 border-t border-rule bg-sunk px-3 py-2">
        <button
          type="button"
          onClick={() => void runAll()}
          disabled={running || !ready}
          className="inline-flex items-center gap-1.5 rounded bg-keep px-3 py-1 text-xs font-medium text-on-keep disabled:opacity-50"
        >
          {running ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? 'Corriendo…' : results === null ? 'Run' : 'Run de nuevo'}
        </button>
        {running && progress !== '' && (
          <span className="font-mono text-3xs text-ink-faint">{progress}</span>
        )}
      </footer>
    </div>
  );
}

type RunOutcome =
  | { kind: 'ok'; ms: number }
  | { kind: 'timeout' }
  | { kind: 'compile-failure'; log: string }
  | { kind: 'crash'; message: string };

async function runOnce(
  run: ReturnType<typeof useLoadedRuntime>['run'],
  source: string,
  n: number,
  timeoutMs: number,
): Promise<RunOutcome> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const raced = await Promise.race([run(source, `${n}\n`), timeoutPromise]);
    if (raced === 'timeout') return { kind: 'timeout' };
    if (raced.exitCode === null) {
      return { kind: 'compile-failure', log: raced.compileLog || 'sin detalle' };
    }
    const ns = parseTimeNs(raced.output);
    if (ns === null) {
      return {
        kind: 'crash',
        message: `no se encontró la línea ${TIME_MARK}<ns> en la salida — la implementación debe imprimirla`,
      };
    }
    return { kind: 'ok', ms: ns / 1_000_000 };
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function parseTimeNs(output: string): number | null {
  for (const line of output.split('\n')) {
    if (line.startsWith(TIME_MARK)) {
      const n = Number(line.slice(TIME_MARK.length).trim());
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function formatMs(ms: number): string {
  if (ms < 0.001) return `${(ms * 1000).toFixed(2)} μs`;
  if (ms < 1) return `${ms.toFixed(3)} ms`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatN(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)} K`;
  return String(n);
}
