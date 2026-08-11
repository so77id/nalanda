import { useCallback, useEffect, useRef, useState } from 'react';

import type { RunResult, RuntimeId, RuntimeWorker, WarmStats, WorkerMessage } from './contract';

export interface UseRuntimeInput {
  /** `null` disables execution entirely: no worker is ever created. */
  runtimeId: RuntimeId | null;
  /** Spawns the worker for `runtimeId`. Called at most once per runtime. */
  createWorker: () => RuntimeWorker;
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
 * Owns one runtime worker and correlates requests with their replies.
 *
 * The worker is created on demand — never on mount — so a document full of
 * read-only snippets downloads no compilers (ADR-0001 pays for laziness with
 * multi-megabyte toolchains; issue #74 AC6/AC7 pin it).
 */
export function useRuntime({ runtimeId, createWorker }: UseRuntimeInput): Runtime {
  const workerRef = useRef<RuntimeWorker | null>(null);
  const pendingRef = useRef(new Map<number, Pending>());
  const nextIdRef = useRef(0);
  const createWorkerRef = useRef(createWorker);
  createWorkerRef.current = createWorker;

  const [warm, setWarm] = useState(false);
  const [warmStats, setWarmStats] = useState<WarmStats | null>(null);

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
        pendingRef.current.set(id, { resolve, reject });
        worker.postMessage({ id, source, stdin });
      });
    },
    [runtimeId, ensureWorker],
  );

  // Tear down when the language changes or the editor unmounts. A worker holds
  // a whole toolchain in memory; leaking one per language switch is not an
  // option.
  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      for (const { reject } of pending.values()) {
        reject(new Error('runtime changed'));
      }
      pending.clear();
    };
  }, [runtimeId]);

  return { run, warmUp, warm, warmStats };
}
