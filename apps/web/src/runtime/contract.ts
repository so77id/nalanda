import type { Extension } from '@codemirror/state';

// The contract every language runtime implements. It is deliberately
// language-agnostic and transport-agnostic: a runtime is "something that turns
// source + stdin into output", whether it compiles in a worker (ADR-0001) or,
// should the Java licence ever force the pivot, behind a network call
// (ADR-0016). Changing language means changing one worker, nothing else.

/** Every language the platform can execute. */
export const RUNTIME_IDS = ['cpp', 'python', 'java'] as const;

export type RuntimeId = (typeof RUNTIME_IDS)[number];

/**
 * The cheap, always-loaded half of a runtime: enough to label a language and
 * seed an editor without pulling in a compiler or a CodeMirror grammar.
 */
export interface RuntimeDescriptor {
  id: RuntimeId;
  /** Shown in the language picker, e.g. "C++20". */
  label: string;
  /** The file name the source is compiled as, e.g. "main.cpp". */
  fileName: string;
  /** Seed source shown when an editor has no content of its own. */
  defaultCode: string;
  /** Renders the runtime's own warm-up numbers, e.g. "pch 120ms · cold compile 300ms". */
  formatWarmStats?: (detail: Record<string, number>) => string;
}

/** A request sent to a runtime worker. `id` correlates it with its reply. */
export interface RunRequest {
  id: number;
  source: string;
  stdin: string;
  /**
   * A second compilation unit, compiled beside `source` and used as the entry
   * point in its place.
   *
   * It exists so an exercise can check a *method*: the code that calls the
   * student's work has to live outside the student's file, or it would be theirs
   * to edit and to break. A runtime that cannot honour it must say so rather
   * than run `source` alone — silently ignoring it would report a passing
   * exercise that verified nothing.
   */
  harness?: string;
}

/** Sent once, unprompted, when the runtime has finished booting. */
export interface WarmMessage {
  type: 'warm';
  /** Runtime-specific timings, rendered by `RuntimeDescriptor.formatWarmStats`. */
  detail?: Record<string, number>;
}

/**
 * The run has left the queue and the runtime is now working on it.
 *
 * It is what separates "waiting" from "running": the caller's deadline should
 * measure the student's program, not a cold CDN or a queue behind another
 * editor. Runtimes send it once per request, before compiling.
 */
export interface StartedMessage {
  id: number;
  type: 'started';
}

/** A completed run. A failed compile is a result, not an error: `exitCode` is null. */
export interface ResultMessage {
  id: number;
  type: 'result';
  compileLog: string;
  output: string;
  exitCode: number | null;
  compileMs: number | null;
  runMs: number | null;
}

/** The runtime itself broke — as opposed to the student's program failing. */
export interface ErrorMessage {
  id: number;
  type: 'error';
  message: string;
}

export type WorkerMessage = WarmMessage | StartedMessage | ResultMessage | ErrorMessage;

/** What `run()` resolves to: a result message without its transport fields. */
export type RunResult = Omit<ResultMessage, 'id' | 'type'>;

/**
 * The subset of `Worker` the runtime layer uses. Narrowing it keeps the hook
 * testable in jsdom, which has no `Worker`, and keeps a future non-worker
 * transport (e.g. a remote compiler) implementable without lying about types.
 */
export interface RuntimeWorker {
  postMessage(message: RunRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerMessage>) => void): void;
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerMessage>) => void,
  ): void;
  terminate(): void;
}

/** Warm-up timings, as surfaced to the UI. */
export interface WarmStats {
  /** Wall-clock from worker creation to the warm message. */
  totalMs: number;
  detail: Record<string, number>;
}

/**
 * The expensive half of a runtime, reached only through `loadRuntime`: it drags
 * in a CodeMirror grammar and a worker entry point, so it must never be reachable
 * from the entry chunk.
 */
export interface RuntimeModule {
  descriptor: RuntimeDescriptor;
  createWorker: () => RuntimeWorker;
  codeMirrorLanguage: () => Extension;
}
