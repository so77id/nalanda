import type { RunRequest } from './contract';

/**
 * Refuses a request carrying a second compilation unit the runtime cannot build.
 *
 * Only Java compiles one today. A runtime that quietly ran `source` alone would
 * report a passing exercise that verified nothing — ADR-0019 §4 calls that the
 * worst failure this feature could have — or draw a memory diagram from a
 * program that was never traced. Either way the answer is to throw rather than
 * ignore the field.
 *
 * **Both units, not just the harness.** `library` (ADR-0026) arrived on the same
 * shared `RunRequest` without arriving here, so C++ and Python would have taken
 * a tracer and run the snippet bare — while ADR-0026 already promised they
 * refuse. The guard covers the shape, not one field name, so the next unit is
 * caught by construction.
 *
 * Extracted from the two workers because the suite cannot run a worker at all:
 * both guards were deletable with 295 tests green until this existed.
 */
export function rejectHarness(request: RunRequest, language: string): void {
  if (request.harness !== undefined) {
    throw new Error(`the ${language} runtime does not support exercises yet`);
  }
  if (request.library !== undefined) {
    throw new Error(`the ${language} runtime does not support memory diagrams yet`);
  }
}
