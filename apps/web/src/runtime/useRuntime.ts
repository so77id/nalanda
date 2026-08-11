import { useCallback, useEffect, useRef, useState } from 'react';

import type { RunResult, RuntimeId, RuntimeWorker, WarmStats, WorkerMessage } from './contract';

/** Generous on purpose: a first Java run legitimately spends ~28s booting (ADR-0017). */
export const DEFAULT_TIMEOUT_MS = 60_000;

export interface UseRuntimeInput {
  /** `null` disables execution entirely: no worker is ever created. */
  runtimeId: RuntimeId | null;
  /** Spawns the worker for `runtimeId`. Called at most once per runtime. */
  createWorker: () => RuntimeWorker;
  /** How long a single run may take before it is abandoned. */
  timeoutMs?: number;
}

export interface Runtime {
  /** Compiles and runs `source`. Spawns the worker on first call. */
  run: (source: string, stdin: string) => Promise<RunResult>;
  /** Starts booting the runtime ahead of the first run. Idempotent. */
  warmUp: () => void;
  /** The runtime has finished booting and a run will not wait on it. */
  warm: boolean;
  warmStats: WarmStats | null;
}

interface Pending {
  resolve: (result: RunResult) => void;
  reject: (error: Error) => void;
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
}: UseRuntimeInput): Runtime {
  const workerRef = useRef<RuntimeWorker | null>(null);
  const pendingRef = useRef(new Map<number, Pending>());
  const nextIdRef = useRef(0);
  const createWorkerRef = useRef(createWorker);
  createWorkerRef.current = createWorker;

  const [warm, setWarm] = useState(false);
  const [warmStats, setWarmStats] = useState<WarmStats | null>(null);

  /** Drops the worker so the next run gets a fresh one, rejecting whatever it owed. */
  const discardWorker = useCallback((reason?: Error) => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setWarm(false);
    setWarmStats(null);
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
      pendingRef.current.delete(message.id);
      if (message.type === 'error') {
        pending.reject(new Error(message.message));
        return;
      }
      const { id: _id, type: _type, ...result } = message;
      pending.resolve(result);
    });

    workerRef.current = worker;
    return worker;
  }, []);

  const warmUp = useCallback(() => {
    if (runtimeId === null) return;
    ensureWorker();
  }, [runtimeId, ensureWorker]);

  const run = useCallback(
    (source: string, stdin: string): Promise<RunResult> => {
      if (runtimeId === null) {
        return Promise.reject(new Error('no runtime selected'));
      }
      const worker = ensureWorker();
      const id = ++nextIdRef.current;
      return new Promise<RunResult>((resolve, reject) => {
        // A student's `while (true)` is the likeliest event in this feature's
        // life, and a stranded worker holds a whole toolchain (~330MB measured).
        // The deadline is generous because a first Java run legitimately spends
        // ~28s booting a JVM and loading a compiler (ADR-0017).
        const deadline = setTimeout(() => {
          pendingRef.current.delete(id);
          discardWorker();
          reject(
            new Error(
              `el programa no terminó en ${Math.round(timeoutMs / 1000)}s — puede tener un bucle infinito`,
            ),
          );
        }, timeoutMs);

        pendingRef.current.set(id, {
          resolve: (result) => {
            clearTimeout(deadline);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(deadline);
            reject(error);
          },
        });
        worker.postMessage({ id, source, stdin });
      });
    },
    [runtimeId, ensureWorker, discardWorker, timeoutMs],
  );

  // Tear down when the language changes or the editor unmounts. A worker holds
  // a whole toolchain in memory; leaking one per language switch is not an
  // option.
  useEffect(() => {
    return () => {
      discardWorker(new RunAbandonedError());
    };
  }, [runtimeId, discardWorker]);

  return { run, warmUp, warm, warmStats };
}
