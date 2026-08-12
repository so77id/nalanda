import { useCallback, useEffect, useRef, useState } from 'react';

import type { RunResult, RuntimeId, RuntimeWorker, WarmStats, WorkerMessage } from './contract';

/** How long the student's program itself may run. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * How long a run may spend *before* it starts: downloading a toolchain, booting
 * a JVM (~12s cold on a warm CDN, ADR-0017), and — for Java — waiting behind another editor
 * on the page's shared queue (~16s measured). Generous, because none of that is
 * the student's fault and none of it means an infinite loop.
 */
export const DEFAULT_START_TIMEOUT_MS = 180_000;

const seconds = (ms: number): string => `${Math.round(ms / 1000)}s`;

export interface UseRuntimeInput {
  /** `null` disables execution entirely: no worker is ever created. */
  runtimeId: RuntimeId | null;
  /** Spawns the worker for `runtimeId`. Called at most once per runtime. */
  createWorker: () => RuntimeWorker;
  /** How long the program may run once the runtime reports it has started. */
  timeoutMs?: number;
  /** How long the runtime may take to get to the program in the first place. */
  startTimeoutMs?: number;
}

export interface Runtime {
  /**
   * Compiles and runs `source`. Spawns the worker on first call.
   *
   * `harness` is a second compilation unit that takes over the entry point —
   * how an exercise checks a method instead of a printed line (see RunRequest).
   */
  run: (source: string, stdin: string, harness?: string) => Promise<RunResult>;
  /** Starts booting the runtime ahead of the first run. Idempotent. */
  warmUp: () => void;
  /** The runtime has finished booting and a run will not wait on it. */
  warm: boolean;
  /**
   * A run has been sent and the runtime has not picked it up yet.
   *
   * Java shares one JVM across every editor on the page (ADR-0017), so a second
   * Comprobar waits for the first to finish — measured at 4.8s with the runtime
   * already warm, which is to say 4.8s in which `warm` says "ready" and nothing
   * on screen explains the stillness. Callers render the difference.
   */
  queued: boolean;
  warmStats: WarmStats | null;
}

interface Pending {
  resolve: (result: RunResult) => void;
  reject: (error: Error) => void;
  /** Swaps the waiting budget for the running one when the run actually starts. */
  rearm: (ms: number, message: string) => void;
}

/**
 * The run was abandoned — the student switched language or left the page — as
 * opposed to failing. Callers swallow it instead of showing it as a diagnostic.
 */
export class RunAbandonedError extends Error {
  constructor() {
    super('the run was abandoned');
    this.name = 'RunAbandonedError';
  }
}

/**
 * Owns one runtime worker and correlates requests with their replies.
 *
 * The worker is created on demand — never on mount — so a document full of
 * read-only snippets downloads no compilers (ADR-0001 pays for laziness with
 * multi-megabyte toolchains; issue #74 AC6/AC7 pin it).
 */
export function useRuntime({
  runtimeId,
  createWorker,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
}: UseRuntimeInput): Runtime {
  const workerRef = useRef<RuntimeWorker | null>(null);
  const pendingRef = useRef(new Map<number, Pending>());
  /** Requests sent and not yet acknowledged with `started`. */
  const waitingRef = useRef(new Set<number>());
  const nextIdRef = useRef(0);
  const createWorkerRef = useRef(createWorker);
  createWorkerRef.current = createWorker;

  const [warm, setWarm] = useState(false);
  const [queued, setQueued] = useState(false);
  const [warmStats, setWarmStats] = useState<WarmStats | null>(null);

  /** A request stopped waiting — because it started, finished, or died. */
  const stopWaiting = useCallback((id: number) => {
    if (waitingRef.current.delete(id)) setQueued(waitingRef.current.size > 0);
  }, []);

  /** Drops the worker so the next run gets a fresh one, rejecting whatever it owed. */
  const discardWorker = useCallback((reason?: Error) => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setWarm(false);
    setWarmStats(null);
    waitingRef.current.clear();
    setQueued(false);
    const pending = pendingRef.current;
    for (const { reject } of pending.values()) {
      reject(reason ?? new RunAbandonedError());
    }
    pending.clear();
  }, []);

  // Reset derived state during render rather than in an effect, so a language
  // switch never paints one frame of the previous runtime's warmth.
  const [previousId, setPreviousId] = useState(runtimeId);
  if (previousId !== runtimeId) {
    setPreviousId(runtimeId);
    setWarm(false);
    setWarmStats(null);
  }

  const ensureWorker = useCallback((): RuntimeWorker => {
    const existing = workerRef.current;
    if (existing) return existing;

    const worker = createWorkerRef.current();
    const startedAt = performance.now();

    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'warm') {
        setWarm(true);
        setWarmStats({
          totalMs: Math.round(performance.now() - startedAt),
          detail: message.detail ?? {},
        });
        return;
      }

      const pending = pendingRef.current.get(message.id);
      if (!pending) return;

      if (message.type === 'started') {
        // The wait is over and the program is what is running now, so restart
        // the clock: a cold CDN or a queue behind another editor must not be
        // charged to the student as an infinite loop.
        stopWaiting(message.id);
        pending.rearm(
          timeoutMs,
          `el programa no terminó en ${seconds(timeoutMs)} — puede tener un bucle infinito`,
        );
        return;
      }

      pendingRef.current.delete(message.id);
      // A runtime that answers without ever saying `started` (or that fails
      // before it can) still leaves the queue.
      stopWaiting(message.id);
      if (message.type === 'error') {
        pending.reject(new Error(message.message));
        return;
      }
      const { id: _id, type: _type, ...result } = message;
      pending.resolve(result);
    });

    workerRef.current = worker;
    return worker;
  }, [timeoutMs, stopWaiting]);

  const warmUp = useCallback(() => {
    if (runtimeId === null) return;
    ensureWorker();
  }, [runtimeId, ensureWorker]);

  const run = useCallback(
    (source: string, stdin: string, harness?: string): Promise<RunResult> => {
      if (runtimeId === null) {
        return Promise.reject(new Error('no runtime selected'));
      }
      const worker = ensureWorker();
      const id = ++nextIdRef.current;
      return new Promise<RunResult>((resolve, reject) => {
        let deadline: ReturnType<typeof setTimeout>;

        // Two budgets, because a student's `while (true)` and a cold CDN are
        // different failures with different honest messages. The first covers
        // getting to the front of the queue with a booted runtime; the
        // `started` message swaps it for the second, which measures the
        // program. A stranded worker holds a whole toolchain (~330MB measured),
        // so either way the worker goes.
        const arm = (ms: number, message: string): void => {
          deadline = setTimeout(() => {
            pendingRef.current.delete(id);
            discardWorker();
            reject(new Error(message));
          }, ms);
        };

        const rearm = (ms: number, message: string): void => {
          clearTimeout(deadline);
          arm(ms, message);
        };

        arm(startTimeoutMs, `el runtime no estuvo listo en ${seconds(startTimeoutMs)}`);

        pendingRef.current.set(id, {
          rearm,
          resolve: (result) => {
            clearTimeout(deadline);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(deadline);
            reject(error);
          },
        });
        waitingRef.current.add(id);
        setQueued(true);
        worker.postMessage({ id, source, stdin, ...(harness === undefined ? {} : { harness }) });
      });
    },
    [runtimeId, ensureWorker, discardWorker, startTimeoutMs],
  );

  // Tear down when the language changes or the editor unmounts. A worker holds
  // a whole toolchain in memory; leaking one per language switch is not an
  // option.
  useEffect(() => {
    return () => {
      discardWorker(new RunAbandonedError());
    };
  }, [runtimeId, discardWorker]);

  return { run, warmUp, warm, queued, warmStats };
}
