import type { RuntimeId } from '../lib/runtimeIds';

// The contract every language runtime implements. It is deliberately
// language-agnostic and transport-agnostic: a runtime is "something that turns
// source + stdin into output", whether it compiles in a worker (ADR-0001) or,
// should the Java licence ever force the pivot, behind a network call
// (ADR-0016). Changing language means changing one worker, nothing else.

// The id set lives in `lib/` so a consumer can ask which languages exist
// without importing this feature — `components/MdxPre` is reached eagerly by
// the shell's MDX map, and importing the runtime seam for it put the whole
// runtime in the entry chunk (ADR-0018). Re-exported here so every existing
// consumer of the contract keeps one import.
export { RUNTIME_IDS } from '../lib/runtimeIds';
export type { RuntimeId } from '../lib/runtimeIds';

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
  /**
   * A second compilation unit, compiled beside `source` and never run.
   *
   * The mirror image of `harness`: platform code the snippet CALLS while the
   * snippet keeps `main`. It exists so a memory diagram can compile its tracer
   * next to the author's program — as a `harness` the tracer would be run
   * instead of the program (and it has no `main`), and swapping the two trips
   * the reserved-name guard on the platform's own class.
   *
   * That guard reads every top-level declaration in `source`, and every one in
   * `harness` except the name that unit owns — not their entry classes alone
   * (#123). It skips this field entirely, deliberately: it exists to stop a
   * student's class shadowing a platform one, and the platform's own unit
   * arriving here is the intended use. Unlike `harness`, which carries an
   * author's `test` fence into a compilation unit, `library` is reachable only
   * from a module constant.
   */
  library?: string;
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
 * in a worker entry point and a whole toolchain, so it must never be reachable
 * from the entry chunk.
 *
 * The CodeMirror grammar is deliberately NOT a member. It used to be, and that
 * made every runtime consumer a CodeMirror consumer — a non-editor consumer
 * paid for a full grammar to render no highlighting at all (measured in
 * ADR-0018 §4). A grammar now comes from `loadGrammar(id)`, separately and
 * only for whoever mounts an editor (#122); the split stays useful for future
 * non-editor consumers of the runtime.
 */
export interface RuntimeModule {
  descriptor: RuntimeDescriptor;
  createWorker: () => RuntimeWorker;
}
