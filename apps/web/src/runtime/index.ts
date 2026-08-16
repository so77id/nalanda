// Public seam of the runtime feature (import direction rule, frontend-code-style.md).
export {
  DEFAULT_START_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  RunAbandonedError,
  useRuntime,
} from './useRuntime';
export type { Runtime, UseRuntimeInput } from './useRuntime';
export { descriptorOf, loadGrammar, loadRuntime, runtimeDescriptors } from './registry';
// The harness's and the tracer's entry classes are the runtime's to name: it
// enforces the reserved set, and `runtime → components` is not an allowed edge.
export { HARNESS_CLASS, TRACE_CLASS } from './java/launcher';
// The sentinel the launcher prints in place of everything past its output
// budget. Exported because a reader of that output has to be able to tell a
// short run from a cut one, and re-typing the string is how the two drift.
export { TRUNCATED } from './java/launcher';
export { RUNTIME_IDS } from './contract';
export type {
  RunRequest,
  RunResult,
  RuntimeDescriptor,
  RuntimeId,
  RuntimeModule,
  RuntimeWorker,
  WarmStats,
  WorkerMessage,
} from './contract';
