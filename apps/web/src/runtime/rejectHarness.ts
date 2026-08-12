import type { RunRequest } from './contract';

/**
 * Refuses a request carrying a harness the runtime cannot compile.
 *
 * Only Java compiles a second unit today. A runtime that quietly ran `source`
 * alone would report a passing exercise that verified nothing — ADR-0019 §4
 * calls that the worst failure this feature could have, which is why it throws
 * rather than ignoring the field.
 *
 * Extracted from the two workers because the suite cannot run a worker at all:
 * both guards were deletable with 295 tests green until this existed.
 */
export function rejectHarness(request: RunRequest, language: string): void {
  if (request.harness !== undefined) {
    throw new Error(`the ${language} runtime does not support exercises yet`);
  }
}
