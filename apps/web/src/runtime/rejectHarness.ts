import type { RunRequest } from './contract';

/**
 * Refuses a request carrying a second compilation unit the runtime cannot build.
 *
 * Only Java compiles one today (a `harness`). A runtime that quietly ran
 * `source` alone would report a passing exercise that verified nothing —
 * ADR-0019 §4 calls that the worst failure this feature could have. The answer
 * is to throw rather than ignore the field.
 *
 * The guard covers the SHAPE (a second unit alongside `source`), not one field
 * name, so a future second unit is caught by construction rather than by
 * remembering to add another `if`. The `library` unit ADR-0028 added for the
 * memory-diagram tracer was retired in #209 alongside the widget itself.
 *
 * Extracted from the two workers because the suite cannot run a worker at all:
 * both guards were deletable with 295 tests green until this existed.
 */
export function rejectHarness(request: RunRequest, language: string): void {
  if (request.harness !== undefined) {
    throw new Error(`the ${language} runtime does not support exercises yet`);
  }
}
